// Live check of the mpv path. Needs network, mpv and yt-dlp, so it is kept out
// of `make check` and run by hand with `make check-music`.
//
// Plays at volume 0, so a check run is silent.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Music} from '../lib/music.js';

const SOCKET_PATH = GLib.build_filenamev([
    GLib.get_tmp_dir(), 'pomodoro-obsidian-mpv.sock',
]);
const URL = 'https://www.youtube.com/watch?v=1-LpQekNa9g';
const OTHER_URL = 'https://www.youtube.com/watch?v=rFZHOHl-L8A';

let failures = 0;

function check(label, condition, detail = '') {
    print(`${condition ? '✔' : '✘'} ${label}${!condition && detail ? `  (${detail})` : ''}`);
    if (!condition)
        failures++;
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

const music = new Music();

check('play() starts mpv', music.play(URL, 0));
check('reports playing straight after the spawn', music.playing);

// mpv binds the socket during startup; yt-dlp resolving the feed is slower and
// irrelevant to whether pause/volume can be sent.
let socketSeen = false;
for (let i = 0; i < 60 && !socketSeen; i++) {
    await sleep(250);
    socketSeen = GLib.file_test(SOCKET_PATH, GLib.FileTest.EXISTS);
}
check('mpv binds the IPC socket', socketSeen, 'gave up after 15s');

if (!socketSeen) {
    music.stop();
    throw new Error('no IPC socket, so the rest cannot be checked');
}

music.pause();
await sleep(400);
check('pause() shows up in playing', music.playing === false);

music.play(URL, 0);
await sleep(400);
check('play() resumes and clears the paused flag', music.playing === true);

music.setVolume(55);
await sleep(200);
check('setVolume() is accepted over IPC', music.playing === true);

music.stop();
await sleep(400);
check('stop() leaves nothing playing', music.playing === false);
check('stop() removes the socket', !GLib.file_test(SOCKET_PATH, GLib.FileTest.EXISTS));

/* ----------------------------- repointing the stream restarts mpv ----- */
// Regression: play() used to resume whatever mpv answered the socket and then
// return before _spawn, discarding `url`. Pasting a new link in prefs updated
// dconf but left the old feed playing.

const pidOf = () => music._process?.get_identifier() ?? null;
const cmdlineOf = pid => {
    if (!pid)
        return '';
    const [, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
    return String.fromCharCode(...bytes).replaceAll('\0', ' ');
};

music.play(URL, 0);
await sleep(600);
const firstPid = pidOf();

music.play(OTHER_URL, 0);
await sleep(600);
const secondPid = pidOf();

check('play() with a new URL restarts mpv instead of resuming it',
    secondPid !== null && secondPid !== firstPid, `pid ${firstPid} → ${secondPid}`);
check('the restarted mpv was launched with the new URL',
    cmdlineOf(secondPid).includes(OTHER_URL), cmdlineOf(secondPid));

music.stop();
await sleep(400);
check('stop() after the restart leaves nothing playing', music.playing === false);

/* ----------------------- a live mpv is never duplicated ------------------ */
// Regression: play() fell through to _spawn whenever the IPC socket did not
// answer, so an unreachable socket (mpv not yet bound, say) started a second
// stream next to the first instead of reusing it.

music.play(URL, 0);
await sleep(600);
const lonePid = pidOf();

try {
    Gio.File.new_for_path(SOCKET_PATH).delete(null);   // simulate an unreachable socket
} catch {
    // already gone
}
music.play(URL, 0);
await sleep(400);

check('an unreachable socket reuses the live mpv instead of spawning a second',
    pidOf() === lonePid, `pid ${lonePid} → ${pidOf()}`);

music.stop();
await sleep(300);

/* ---------------------- reset() closes even a stray mpv ----------------- */
// Regression: closing the stream only force-exited the mpv this instance
// spawned, so an mpv orphaned by a shell crash kept its memory. reset() also
// sends quit over the socket, which any mpv listening there obeys.

const stray = Gio.Subprocess.new(
    ['mpv', '--no-video', '--no-terminal', '--really-quiet', '--idle=yes',
        `--input-ipc-server=${SOCKET_PATH}`],
    Gio.SubprocessFlags.NONE);
const strayPid = stray.get_identifier();

let strayListening = false;
for (let i = 0; i < 60 && !strayListening; i++) {
    await sleep(250);
    strayListening = GLib.file_test(SOCKET_PATH, GLib.FileTest.EXISTS);
}
check('an idle mpv binds the socket for the reset check', strayListening);

music.reset();
await sleep(800);
check('reset() quits the stray mpv it never spawned',
    !GLib.file_test(`/proc/${strayPid}`, GLib.FileTest.EXISTS));
check('reset() removes the socket', !GLib.file_test(SOCKET_PATH, GLib.FileTest.EXISTS));

if (GLib.file_test(`/proc/${strayPid}`, GLib.FileTest.EXISTS))
    stray.force_exit();   // do not leak the player when the check fails

print(`\n${failures} failure(s)`);
if (failures > 0)
    throw new Error('music check failed');
