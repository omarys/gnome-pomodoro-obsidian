// Reads and writes Obsidian daily notes. gjs-only (Gio/GLib), kept apart from
// note-logic.js so the text rules stay testable under `node --test`.
//
// Layout this assumes, verified against the real vaults:
//   <vault-root>/<vault>/daily/YYYY-MM-DD.md
//   <vault-root>/<vault>/templates/daily.md   ({{date}} substituted)
//   <vault-root>/<vault>/jira/<key>-<slug>.md
//
// The vault is named by the caller rather than read from a setting: the work
// and personal task fields each log to their own vault, so no vault is "active".
// Both vaults in the real setup carry the same template and the same
// "### Focus & Objectives" heading, so one code path serves either.
//
// ponytail: file IO is synchronous. A daily note is a few KB on local disk and
// this runs once per finished pomodoro, not per frame. Switch to _promisify'd
// async if a vault ever lives on a network mount.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {renderDailyNote, updateModifiedFrontmatter, upsertFocusEntry} from './note-logic.js';
import {findJiraFile, jiraLabel, jiraTitleFromNote} from './task-parse.js';

/** Vaults under the vault root. Order is the order the menu lists them in. */
export const VAULTS = ['work', 'personal'];

export function todayStamp() {
    const now = GLib.DateTime.new_now_local();
    return {
        date: now.format('%Y-%m-%d'),
        time: now.format('%H:%M'),
        longDate: now.format('%B %-d, %Y'),
    };
}

function vaultDir(settings, vault) {
    return GLib.build_filenamev([settings.get_string('vault-root'), vault]);
}

export function dailyNotePath(settings, vault, date) {
    return GLib.build_filenamev([vaultDir(settings, vault), 'daily', `${date}.md`]);
}

function readFile(path) {
    try {
        const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;   // no such file, or unreadable
    }
}

function writeFile(path, text) {
    const file = Gio.File.new_for_path(path);
    const dir = file.get_parent();
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    file.replace_contents(
        new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function markdownNames(dir) {
    try {
        const enumerator = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const names = [];
        for (let info = enumerator.next_file(null); info !== null;
            info = enumerator.next_file(null)) {
            const name = info.get_name();
            if (name.endsWith('.md'))
                names.push(name);
        }
        return names;
    } catch {
        return [];
    }
}

/**
 * Gives each Jira task the title from its note, so the daily note reads
 * "UPES-2952 Pin component version" instead of a bare key. Matching is by key,
 * so the richer label can never create a duplicate line.
 */
export function resolveTaskLabels(settings, vault, tasks) {
    if (!tasks.some(task => task.kind === 'jira'))
        return tasks;

    const dir = GLib.build_filenamev([vaultDir(settings, vault), 'jira']);
    const names = markdownNames(dir);

    return tasks.map(task => {
        if (task.kind !== 'jira')
            return task;
        const name = findJiraFile(names, task.id);
        if (!name)
            return task;
        const content = readFile(GLib.build_filenamev([dir, name])) ?? '';
        const title = jiraTitleFromNote(content, task.id, name);
        return {...task, label: jiraLabel(task.id, title)};
    });
}

/**
 * Records focus time against every task in one vault's daily note, creating the
 * note from that vault's template when it does not exist yet. Returns
 * {path, text}, or null when there is nothing worth logging.
 *
 * Called once per vault, so a phase with both fields filled logs its full
 * duration in both notes. Within a note, each task receives the full number of
 * minutes: with several tickets listed, every line records that the task took
 * part in the focus time. Listing one ticket (the usual case) makes this simply
 * its running total.
 */
export function logPomodoro(settings, vault, tasks, {minutes, pomodoros = 1, date = null}) {
    if (tasks.length === 0 || minutes < 1)
        return null;

    const stamp = todayStamp();
    const target = date ?? stamp.date;
    const path = dailyNotePath(settings, vault, target);

    let text = readFile(path);
    if (text === null) {
        const template = readFile(GLib.build_filenamev([
            vaultDir(settings, vault), 'templates', 'daily.md',
        ]));
        text = renderDailyNote({...stamp, date: target, template});
    }

    for (const task of resolveTaskLabels(settings, vault, tasks))
        text = upsertFocusEntry(text, task, minutes, pomodoros);

    text = updateModifiedFrontmatter(text, `${target} ${stamp.time}`);
    writeFile(path, text);
    return {path, text};
}
