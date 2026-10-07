import test from 'node:test';
import assert from 'node:assert/strict';

import {
    findJiraFile,
    jiraLabel,
    jiraTitleFromNote,
    parseTaskInput,
    serialiseTasks,
    titleFromFilename,
    toTask,
} from '../lib/task-parse.js';

test('splits comma-separated input and drops blanks', () => {
    const tasks = parseTaskInput(' UPES-2964 , , upes-2885,#research ,  write the docs ');
    assert.deepEqual(tasks.map(t => t.id), [
        'UPES-2964',
        'UPES-2885',
        '#research',
        'write the docs',
    ]);
    assert.deepEqual(tasks.map(t => t.kind), ['jira', 'jira', 'label', 'label']);
});

test('uppercases jira keys and uses the key as the match key', () => {
    assert.deepEqual(toTask('upes-2964'), {
        kind: 'jira', id: 'UPES-2964', label: 'UPES-2964', matchKey: 'UPES-2964',
    });
});

test('bare words become tags, explicit tags and phrases are kept', () => {
    assert.equal(toTask('research').label, '#research');
    assert.equal(toTask('#research').label, '#research');
    assert.equal(toTask('write the docs').label, 'write the docs');
    assert.equal(toTask('#research').matchKey, null);
});

test('serialises back to the comma-separated input form', () => {
    const input = 'UPES-2964, #research';
    assert.equal(serialiseTasks(parseTaskInput(input)), input);
});

test('resolves a jira note by key prefix', () => {
    const names = [
        'upes-2885-package-keycloak-and-jcwa.md',
        'upes-2964-create-local-compatibility-test-fixtures.md',
    ];
    assert.equal(
        findJiraFile(names, 'UPES-2964'),
        'upes-2964-create-local-compatibility-test-fixtures.md');
    assert.equal(findJiraFile(names, 'upes-2964'), 'upes-2964-create-local-compatibility-test-fixtures.md');
    assert.equal(findJiraFile(names, 'UPES-9999'), null);
});

test('extracts the title from a real jira note', () => {
    const content = [
        '---',
        'id: upes-2964-create-local-compatibility-test-fixtures',
        'aliases:',
        '  - "[UPES-2964] Create local compatibility test fixtures"',
        '  - UPES-2964',
        'jira_key: UPES-2964',
        '---',
        '',
        '## [ ] [UPES-2964] Create local compatibility test fixtures',
        '',
        '- **Jira Key**: UPES-2964',
    ].join('\n');

    assert.equal(jiraTitleFromNote(content, 'UPES-2964'), 'Create local compatibility test fixtures');
    assert.equal(
        jiraLabel('UPES-2964', jiraTitleFromNote(content, 'UPES-2964')),
        'UPES-2964 Create local compatibility test fixtures');
});

test('falls back to the H2 then to the filename slug', () => {
    const noAlias = '## [ ] [UPES-2964] Create local compatibility test fixtures\n';
    assert.equal(jiraTitleFromNote(noAlias, 'UPES-2964'), 'Create local compatibility test fixtures');

    assert.equal(
        jiraTitleFromNote('no heading here', 'UPES-2964', 'upes-2964-create-local-fixtures.md'),
        'Create local fixtures');
    assert.equal(titleFromFilename('upes-2964-x.md', 'UPES-2964'), 'X');
});

test('does not confuse a different key alias for the requested one', () => {
    const content = 'aliases:\n  - "[UPES-2885] Something else"\n  - "[UPES-2964] The right one"\n';
    assert.equal(jiraTitleFromNote(content, 'UPES-2964'), 'The right one');
});
