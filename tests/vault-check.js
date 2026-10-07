// End-to-end check of the vault writer: the shipped GSettings schema, a
// throwaway vault under /tmp, and the note shapes the real vaults use.
//
// Run with `make check`. Needs gjs but no display. The user's actual vault is
// never touched; --root is a temp dir that is removed again at the end.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseTaskInput} from '../lib/task-parse.js';
import {dailyNotePath, logPomodoro} from '../lib/vault.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.pomodoro-obsidian';
// Anchored to the same wall clock lib/vault.js uses for "today"
// (GLib.DateTime.new_now_local().format('%Y-%m-%d')). Hardcoded dates go stale
// the day after they're written and take every check that reads this note down.
const dayOffset = n => GLib.DateTime.new_now_local().add_days(n).format('%Y-%m-%d');
const DATE = dayOffset(0);
const FRESH_DATE = dayOffset(1);
const BOTH_DATE = dayOffset(2);
const FOCUS = '### Focus & Objectives';
const NEXT_SECTION = '### Research & Discoveries';

// Copied in shape from the real vault template, which carries no frontmatter:
// renderDailyNote synthesises that itself.
const TEMPLATE = `## Daily Log — {{date}}

${FOCUS}

- [ ]

${NEXT_SECTION}

-

### Fleeting Notes Captured

-
`;

// Also in the shape of a real note, down to the unquoted modified field.
const EXISTING_NOTE = `---
id: "2026-10-05"
aliases:
  - October 5, 2026
tags:
  - daily-notes
created: 2026-10-05 09:00
modified: 2026-10-01 09:00
title: ""
---

## Daily Log — 2026-10-05

${FOCUS}

- [ ] Existing handwritten task
- [ ] UPES-2952 Pin component version

${NEXT_SECTION}

- Cilium drops Prometheus scrapes on the \`cti\` namespace.

### Fleeting Notes Captured

-
`;

/* ---------------------------------------------------------------- helpers */

let passed = 0;
let failures = 0;

function check(label, condition, detail = '') {
    if (condition) {
        passed++;
        print(`✔ ${label}`);
    } else {
        failures++;
        print(`✘ ${label}${detail ? `\n    ${detail}` : ''}`);
    }
}

function mkdirp(path) {
    const dir = Gio.File.new_for_path(path);
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
}

function write(path, text) {
    Gio.File.new_for_path(path).replace_contents(
        new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

function read(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return ok ? new TextDecoder().decode(bytes) : '';
}

function rmdir(path) {
    const dir = Gio.File.new_for_path(path);
    let enumerator;
    try {
        enumerator = dir.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch {
        return;
    }
    for (let info = enumerator.next_file(null); info;
        info = enumerator.next_file(null)) {
        const child = dir.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            rmdir(child.get_path());
        else
            child.delete(null);
    }
    dir.delete(null);
}

/** The text of one section, from its heading to the next given heading. */
function section(text, heading, next) {
    const start = text.indexOf(heading);
    if (start < 0)
        return '';
    const end = next ? text.indexOf(next, start + heading.length) : -1;
    return text.slice(start, end < 0 ? text.length : end);
}

const countOf = (text, needle) => text.split(needle).length - 1;

/* ------------------------------------------------------------------ setup */

const root = GLib.dir_make_tmp('pomodoro-obsidian-check-XXXXXX');
const work = GLib.build_filenamev([root, 'work']);
mkdirp(GLib.build_filenamev([work, 'templates']));
mkdirp(GLib.build_filenamev([work, 'daily']));
write(GLib.build_filenamev([work, 'templates', 'daily.md']), TEMPLATE);
write(GLib.build_filenamev([work, 'daily', `${DATE}.md`]), EXISTING_NOTE);

// A second vault, so the work/personal split is exercised against two real
// destinations instead of one vault written twice.
const personal = GLib.build_filenamev([root, 'personal']);
mkdirp(GLib.build_filenamev([personal, 'templates']));
mkdirp(GLib.build_filenamev([personal, 'daily']));
write(GLib.build_filenamev([personal, 'templates', 'daily.md']), TEMPLATE);

// The repo root, so the schema is read from the checkout rather than from an
// installed extension.
const scriptPath = GLib.filename_from_uri(import.meta.url)[0];
const repoRoot = GLib.path_get_dirname(GLib.path_get_dirname(scriptPath));
const source = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([repoRoot, 'schemas']),
    Gio.SettingsSchemaSource.get_default(), false);
const schema = source.lookup(SCHEMA_ID, true);
if (!schema)
    throw new Error(`schema ${SCHEMA_ID} not found — run \`make schemas\``);

const settings = new Gio.Settings({settings_schema: schema});
settings.set_string('vault-root', root);

const tasks = parseTaskInput('UPES-2952, #lofi');

/* ------------------------------------------------------- into a real note */

const first = logPomodoro(settings, 'work', tasks, {minutes: 25});
check('logs into today\'s daily note',
    first?.path === dailyNotePath(settings, 'work', DATE), first?.path);

let note = read(first.path);
let focus = section(note, FOCUS, NEXT_SECTION);

check('suffixes the matching jira line',
    focus.includes('UPES-2952 Pin component version · 25m (1 pomodoro)'), focus);
check('leaves an unrelated handwritten line alone',
    note.includes('- [ ] Existing handwritten task'));
check('appends the tag line inside the section',
    focus.includes('#lofi · 25m (1 pomodoro)'), focus);
check('keeps the tag line out of the next section',
    !section(note, NEXT_SECTION).includes('#lofi'));
check('preserves the rest of the note',
    note.includes('Cilium drops Prometheus scrapes on the `cti` namespace.') &&
        note.includes('### Fleeting Notes Captured'));
// The vault writes this field unquoted (id above is quoted); rewriting it
// quoted would churn every note the extension touches.
const modifiedLine = note.split('\n').find(line => line.startsWith('modified:')) ?? '';
check('restamps modified in the vault\'s own unquoted style',
    modifiedLine.startsWith(`modified: ${DATE} `) && !modifiedLine.includes('"') &&
        !note.includes('2026-10-01 09:00'),
    modifiedLine);

/* ------------------------------------------------------------ accumulates */

const second = logPomodoro(settings, 'work', tasks, {minutes: 25});
note = read(second.path);
focus = section(note, FOCUS, NEXT_SECTION);

check('adds the second pomodoro to the same line',
    focus.includes('UPES-2952 Pin component version · 50m (2 pomodoros)'), focus);
check('does not duplicate the jira line', countOf(focus, 'UPES-2952') === 1, focus);
check('does not duplicate the tag line', countOf(focus, '#lofi') === 1, focus);

/* ------------------------------------------------------ a brand new note */

const fresh = logPomodoro(settings, 'personal', parseTaskInput('errands, #admin'),
    {minutes: 25, date: FRESH_DATE});
const created = read(fresh.path);

check('creates a missing daily note in the personal vault',
    fresh.path === dailyNotePath(settings, 'personal', FRESH_DATE) &&
        created.length > 0, fresh.path);
check('fills in the template placeholders',
    !created.includes('{{') && created.includes(FRESH_DATE));
check('writes the entry under the focus heading',
    section(created, FOCUS, NEXT_SECTION).includes('#admin · 25m (1 pomodoro)'),
    created);
check('keeps the bare tag spelled as a tag',
    section(created, FOCUS, NEXT_SECTION).includes('#errands'));
check('synthesises the vault\'s frontmatter when the template has none',
    created.startsWith('---\n') && created.includes(`id: "${FRESH_DATE}"`) &&
        /^modified: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m.test(created),
    created.split('\n').slice(0, 11).join('\n'));

/* ------------------------------------------- work and personal side by side */

const workLogged = logPomodoro(settings, 'work', parseTaskInput('UPES-2952'),
    {minutes: 25, date: BOTH_DATE});
const personalLogged = logPomodoro(settings, 'personal', parseTaskInput('budget, #admin'),
    {minutes: 25, date: BOTH_DATE});

check('one phase reached both vaults, each note of its own',
    workLogged?.path === dailyNotePath(settings, 'work', BOTH_DATE) &&
        personalLogged?.path === dailyNotePath(settings, 'personal', BOTH_DATE),
    `${workLogged?.path} / ${personalLogged?.path}`);

const workNote = read(workLogged.path);
const personalNote = read(personalLogged.path);

check('the work note holds only the work field',
    workNote.includes('UPES-2952') && !workNote.includes('#admin'));
check('the personal note holds only the personal field',
    personalNote.includes('#admin') && !personalNote.includes('UPES-2952'));
check('both notes record the whole phase',
    section(workNote, FOCUS, NEXT_SECTION).includes('· 25m (1 pomodoro)') &&
        section(personalNote, FOCUS, NEXT_SECTION).includes('· 25m (1 pomodoro)'));

/* ------------------------------------------------------------------ report */

rmdir(root);
print(`\n${passed} passed, ${failures} failed`);
if (failures > 0)
    throw new Error(`${failures} vault check(s) failed`);
