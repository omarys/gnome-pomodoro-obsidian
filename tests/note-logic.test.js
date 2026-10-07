import test from 'node:test';
import assert from 'node:assert/strict';

import {
    FOCUS_HEADING,
    dailyNoteBody,
    ensureFocusSection,
    findFocusSection,
    formatMinutes,
    formatSuffix,
    hasFocusSection,
    parseDuration,
    parseSuffix,
    renderDailyNote,
    stripSuffix,
    updateModifiedFrontmatter,
    upsertFocusEntry,
} from '../lib/note-logic.js';

const NOTE = [
    '---',
    'id: "2026-10-05"',
    'modified: 2026-10-05 09:00',
    'title: ""',
    '---',
    '',
    '## Daily Log — 2026-10-05',
    '',
    '### Focus & Objectives',
    '',
    '- [x] Fix mani task to correctly add `connectors_sdk` dependency',
    '- [ ] Create new tagged releases for all OpenCTI connectors',
    '',
    '### Research & Discoveries',
    '',
    '-',
    '',
].join('\n');

const jira = (key, title) => ({kind: 'jira', id: key, label: `${key} ${title}`, matchKey: key});
const label = text => ({kind: 'label', id: text, label: text, matchKey: null});

test('formats and parses durations round-trip', () => {
    assert.equal(formatMinutes(0), '0m');
    assert.equal(formatMinutes(25), '25m');
    assert.equal(formatMinutes(60), '1h');
    assert.equal(formatMinutes(75), '1h 15m');
    assert.equal(formatMinutes(120), '2h');
    assert.equal(formatMinutes(59.6), '1h');

    assert.equal(parseDuration('50m'), 50);
    assert.equal(parseDuration('1h 15m'), 75);
    assert.equal(parseDuration('2h'), 120);
});

test('parses and strips a time suffix', () => {
    const line = '- [x] UPES-2964 Create fixtures · 50m (2 pomodoros)';
    assert.deepEqual(parseSuffix(line), {minutes: 50, pomodoros: 2});
    assert.equal(stripSuffix(line), '- [x] UPES-2964 Create fixtures');

    assert.deepEqual(parseSuffix('- [x] Thing · 1h 15m (1 pomodoro)'), {minutes: 75, pomodoros: 1});
    assert.equal(parseSuffix('- [x] Thing'), null);
    assert.equal(stripSuffix('- [x] Thing'), '- [x] Thing');
});

test('finds the focus section and its bounds', () => {
    const {lines, headingIndex, bodyEnd} = findFocusSection(NOTE);
    assert.equal(lines[headingIndex], FOCUS_HEADING);
    assert.equal(lines[bodyEnd], '### Research & Discoveries');
    assert.equal(findFocusSection('## Daily Log\n'), null);
});

test('appends a new entry to the end of the section, before the next heading', () => {
    const out = upsertFocusEntry(NOTE, jira('UPES-2964', 'Create local fixtures'), 25, 1);
    const lines = out.split('\n');
    const at = lines.indexOf('- [ ] UPES-2964 Create local fixtures · 25m (1 pomodoro)');
    assert.ok(at > 0, 'entry inserted');
    assert.equal(lines[at - 1], '- [ ] Create new tagged releases for all OpenCTI connectors');
    assert.equal(lines[at + 1], '');
    assert.equal(lines[at + 2], '### Research & Discoveries');
});

test('increments the suffix on an existing line and preserves its checkbox', () => {
    const first = upsertFocusEntry(NOTE, jira('UPES-2964', 'Create local fixtures'), 25, 1);
    const second = upsertFocusEntry(first, jira('UPES-2964', 'A different wording'), 25, 1);

    assert.ok(second.includes('- [ ] UPES-2964 Create local fixtures · 50m (2 pomodoros)'));
    assert.equal(second.match(/UPES-2964/g).length, 1, 'no duplicate line');
    assert.ok(second.includes('- [x] Fix mani task'), 'untouched lines survive');
});

test('adds a suffix to an existing line that has none', () => {
    const out = upsertFocusEntry(NOTE, label('#research'), 25, 1);
    assert.ok(out.includes('- [ ] #research · 25m (1 pomodoro)'));
});

test('matches an existing handwritten line by normalised label', () => {
    const out = upsertFocusEntry(NOTE, label('#research'), 25, 1);
    const twice = upsertFocusEntry(out, label('#research'), 25, 1);
    assert.equal(twice.match(/#research/g).length, 1);
    assert.ok(twice.includes('#research · 50m (2 pomodoros)'));
});

test('jira matching is case-insensitive and mentions-based', () => {
    const pre = upsertFocusEntry(NOTE, jira('UPES-2964', 'X'), 25, 1);
    const out = upsertFocusEntry(pre, {kind: 'jira', id: 'upes-2964', label: 'upes-2964', matchKey: 'upes-2964'}, 25, 1);
    assert.equal(out.match(/UPES-2964/gi).length, 1);
});

test('preserves indentation of a matched nested line', () => {
    const note = `${FOCUS_HEADING}\n\n- [ ] Unrelated\n  - [ ] #research RabbitMQ vs Kafka\n`;
    const out = upsertFocusEntry(note, label('#research'), 25, 1);

    assert.ok(out.includes('  - [ ] #research RabbitMQ vs Kafka · 25m (1 pomodoro)'));
    assert.ok(out.includes('- [ ] Unrelated\n'), 'sibling untouched');
    assert.equal(out.match(/#research/g).length, 1, 'matched in place, not duplicated');
});

test('a tag does not match a longer tag that merely starts with it', () => {
    const note = `${FOCUS_HEADING}\n\n- [ ] #researching something else\n`;
    const out = upsertFocusEntry(note, label('#research'), 25, 1);

    assert.ok(out.includes('- [ ] #researching something else\n'), 'unrelated tag untouched');
    assert.ok(out.includes('- [ ] #research · 25m (1 pomodoro)'));
});

test('creates the focus section when the heading is missing', () => {
    const out = upsertFocusEntry('## Daily Log — 2026-10-05\n', label('#focus'), 25, 1);
    assert.ok(hasFocusSection(out));
    assert.ok(out.includes(`${FOCUS_HEADING}\n- [ ] #focus · 25m (1 pomodoro)`));
});

test('handles a section that runs to end of file', () => {
    const out = upsertFocusEntry(`${FOCUS_HEADING}\n\n- [ ] Existing`, jira('UPES-1', 'New'), 25, 1);
    assert.equal(out, `${FOCUS_HEADING}\n\n- [ ] Existing\n- [ ] UPES-1 New · 25m (1 pomodoro)`);
});

test('handles an empty section body', () => {
    const out = upsertFocusEntry(`${FOCUS_HEADING}\n\n### Next\n`, jira('UPES-1', 'New'), 25, 1);
    assert.ok(out.includes(`${FOCUS_HEADING}\n- [ ] UPES-1 New · 25m (1 pomodoro)\n`));
});

test('does not treat a level-4 heading as a section boundary', () => {
    const text = `${FOCUS_HEADING}\n\n- [ ] Kept\n\n#### Notes\n\n- [ ] Inside`;
    const out = upsertFocusEntry(text, jira('UPES-1', 'New'), 25, 1);
    assert.ok(out.includes('- [ ] Inside'));
    assert.ok(out.indexOf('UPES-1') > out.indexOf('Inside'));
});

test('ensureFocusSection is idempotent', () => {
    const once = ensureFocusSection('# Hello\n');
    assert.equal(ensureFocusSection(once), once);
});

test('updates only the modified frontmatter field', () => {
    const out = updateModifiedFrontmatter(NOTE, '2026-10-05 14:30');
    assert.ok(out.includes('modified: 2026-10-05 14:30'));
    assert.ok(out.includes('id: "2026-10-05"'));
    assert.equal(updateModifiedFrontmatter('no frontmatter\n', 'x'), 'no frontmatter\n');
});

test('renders a daily note matching the vault template shape', () => {
    const template = '## Daily Log — {{date}}\n\n### Focus & Objectives\n\n- [ ]\n';
    const out = renderDailyNote({
        date: '2026-10-05',
        time: '10:18',
        longDate: 'October 5, 2026',
        template,
    });

    assert.ok(out.startsWith('---\nid: "2026-10-05"\n'));
    assert.ok(out.includes('  - October 5, 2026\n'));
    assert.ok(out.includes('created: 2026-10-05 10:18'));
    assert.ok(out.includes('modified: 2026-10-05 10:18'));
    assert.ok(out.includes('## Daily Log — 2026-10-05'));
    assert.ok(out.endsWith('\n'));

    // The rendered note must be usable directly.
    const logged = upsertFocusEntry(out, jira('UPES-1', 'New'), 25, 1);
    assert.ok(logged.includes('- [ ] UPES-1 New · 25m (1 pomodoro)'));
});

test('falls back to a built-in body when the vault has no template', () => {
    const body = dailyNoteBody('2026-10-05', '10:18', null);
    assert.ok(body.includes('### Focus & Objectives'));
    assert.ok(body.includes('### Tasks & Follow-ups'));
    assert.ok(!body.includes('{{date}}'));
});
