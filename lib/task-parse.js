// Pure parsing for the "what am I working on" input and for Jira note lookup.
// No gi:// imports: importable by node --test and by the GNOME extension alike.

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/i;
const JIRA_ALIAS_RE = /^\[([A-Z][A-Z0-9]*-\d+)\]\s*(.+)$/i;

/**
 * Splits a comma-separated input into tasks.
 * "UPES-2964, upes-2885, research, write the docs"
 * -> [{kind:'jira', id:'UPES-2964', label:'UPES-2964', matchKey:'UPES-2964'}, ...,
 *     {kind:'label', id:'#research', label:'#research', matchKey:null}, ...]
 */
export function parseTaskInput(input) {
    return String(input ?? '')
        .split(',')
        .map(token => token.trim())
        .filter(token => token !== '')
        .map(toTask);
}

export function toTask(token) {
    const text = token.trim();

    if (JIRA_KEY_RE.test(text)) {
        const key = text.toUpperCase();
        return {kind: 'jira', id: key, label: key, matchKey: key};
    }

    // A single bare word is an Obsidian tag; an explicit #tag or a phrase is
    // taken as typed.
    const label = text.startsWith('#') || /\s/.test(text) ? text : `#${text}`;
    return {kind: 'label', id: label, label, matchKey: null};
}

export function serialiseTasks(tasks) {
    return tasks.map(task => task.kind === 'jira' ? task.id : task.label).join(', ');
}

/** Finds the vault note for a Jira key. `names` are bare filenames. */
export function findJiraFile(names, key) {
    const prefix = `${key.toLowerCase()}-`;
    const exact = `${key.toLowerCase()}.md`;
    for (const name of names) {
        if (name.toLowerCase() === exact || name.toLowerCase().startsWith(prefix))
            return name;
    }
    return null;
}

/**
 * Pulls a human title out of a Jira note: the "[KEY] Title" alias, else the
 * "[ ] [KEY] Title" H2, else the slug with the key stripped.
 */
export function jiraTitleFromNote(content, key, filename = '') {
    for (const raw of content.split('\n')) {
        const line = raw.trim().replace(/^-\s+/, '');
        const quoted = /^["'](.*)["']$/.exec(line);
        const value = quoted ? quoted[1] : line;
        const alias = JIRA_ALIAS_RE.exec(value);
        if (alias && alias[1].toUpperCase() === key.toUpperCase())
            return alias[2].trim();
    }

    const heading = /^##\s+\[[ xX>]\]\s+(.*)$/m.exec(content);
    if (heading) {
        const title = heading[1].replace(/^\[[A-Z][A-Z0-9]*-\d+\]\s*/i, '').trim();
        if (title)
            return title;
    }

    return titleFromFilename(filename, key);
}

export function titleFromFilename(filename, key) {
    let slug = filename.replace(/\.md$/i, '');
    if (key)
        slug = slug.replace(new RegExp(`^${key.toLowerCase()}-`, 'i'), '');
    slug = slug.replace(/[-_]+/g, ' ').trim();
    return slug === '' ? '' : slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Label written into the daily note, e.g. "UPES-2964 Create local fixtures". */
export function jiraLabel(key, title) {
    return title ? `${key} ${title}` : key;
}
