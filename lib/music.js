// Streams the lofi feed through mpv, controlled over mpv's JSON IPC socket.
// Using the socket rather than owning mpv's stdout means we can attach to an
// mpv the user already has running, and pause/volume changes are one-liners.
//
// ponytail: the paused flag is tracked locally, so external control of mpv
// would desync the toggle. Add "observe_property" if that ever matters.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const DEFAULT_URL = 'https://www.youtube.com/watch?v=1-LpQekNa9g';

const SOCKET_PATH = GLib.build_filenamev([GLib.get_tmp_dir(), 'pomodoro-obsidian-mpv.sock']);

export class Music {
    constructor() {
        this._process = null;
        this._connection = null;
        this._paused = false;
        this._url = null;   // the URL the live mpv was spawned with
    }

    /** True while mpv is up and not paused. */
    get playing() {
        // Not `_connection`: mpv plays from the moment it spawns, and the
        // socket only appears a moment later. _spawn clears _process on exit.
        return !this._paused && this._process !== null;
    }

    play(url = DEFAULT_URL, volume = 40) {
        // Reuse the mpv we already own. mpv plays whatever URL it was spawned
        // with, so a changed URL means restarting it and the same URL only
        // needs unpausing. Never spawn a second one here: the IPC socket is
        // briefly absent right after a spawn, and falling through to _spawn in
        // that window started a duplicate stream alongside the first.
        if (this._process !== null) {
            if (url !== this._url) {
                this.stop();
                return this._spawn(url, volume);
            }
            this._command(['set_property', 'pause', false]);
            this._paused = false;   // resuming the mpv we paused earlier
            return true;
        }
        return this._spawn(url, volume);
    }

    pause() {
        if (this._command(['set_property', 'pause', true]))
            this._paused = true;
    }

    toggle(url, volume) {
        if (this.playing)
            this.pause();
        else
            this.play(url, volume);
    }

    setVolume(volume) {
        this._command(['set_property', 'volume', volume]);
    }

    stop() {
        this._close();
        this._process?.force_exit();
        this._process = null;
        this._paused = false;
        this._url = null;
        try {
            Gio.File.new_for_path(SOCKET_PATH).delete(null);
        } catch {
            // already gone
        }
    }

    /* ------------------------------------------------------------- internals */

    _spawn(url, volume) {
        // A socket file left behind by a dead mpv would stop a new one binding,
        // so clear it before starting.
        try {
            Gio.File.new_for_path(SOCKET_PATH).delete(null);
        } catch {
            // nothing stale to remove
        }

        try {
            this._process = Gio.Subprocess.new(
                ['mpv', '--no-video', '--no-terminal', '--really-quiet',
                    // YouTube needs an audio-only pick: the default may be a
                    // video stream whose muxed audio mpv then has to discard.
                    '--ytdl-format=bestaudio/best',
                    `--input-ipc-server=${SOCKET_PATH}`, `--volume=${volume}`, url],
                Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'pomodoro-obsidian: could not start mpv');
            return false;
        }

        // mpv is already playing the URL it was launched with; the socket is
        // only needed for pause/volume, so it can appear whenever it likes.
        this._paused = false;
        this._url = url;

        // Waiting also reaps mpv, which would otherwise sit around as a zombie,
        // and doubles as the liveness signal for `playing`.
        const process = this._process;
        process.wait_async(null, (proc, result) => {
            try {
                proc.wait_finish(result);
            } catch {
                // wait failed; the process is still gone as far as we care
            }
            if (this._process === process)
                this._process = null;
        });

        return true;
    }

    _command(args) {
        const connection = this._connection ?? this._connect();
        if (connection === null)
            return false;
        this._connection = connection;
        try {
            connection.get_output_stream().write_all(
                `${JSON.stringify({command: args})}\n`, null);
            return true;
        } catch {
            this._connection = null;
            return false;
        }
    }

    _connect() {
        if (!GLib.file_test(SOCKET_PATH, GLib.FileTest.EXISTS))
            return null;
        try {
            return new Gio.SocketClient().connect(
                Gio.UnixSocketAddress.new(SOCKET_PATH), null);
        } catch {
            return null;   // not listening
        }
    }

    _close() {
        try {
            this._connection?.close(null);
        } catch {
            // already closed
        }
        this._connection = null;
    }
}
