// Pure text logic for Obsidian daily notes. No gi:// imports: importable by
// node --test and by the GNOME extension alike.

export const FOCUS_HEADING = '### Focus & Objectives';

const HEADING_RE = /^###\s*Focus\s*(?:&|and)\s*Objectives\s*$/i;
const ANY_HEADING_RE = /^#{1,3}\s+\S/;
const LIST_ITEM_RE = /^(\s*)([-*])\s+\[([ xX>])\]\s+(.*)$/;

// " · 50m (2 pomodoros)"
const SUFFIX_RE = /\s*·\s*((?:\d+h\s*)?\d+m)\s*\((\d+)\s+pomodoros?\)\s*$/;

/* ---------------------------------------------------------------- durations */

export function parseDuration(text) {
    const h = /(\d+)\s*h/.exec(text);
    const m = /(\d+)\s*m/.exec(text);
    return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
}

export function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(minutes));
    if (total < 60)
        return `${total}m`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatSuffix(minutes, pomodoros) {
    const word = pomodoros === 1 ? 'pomodoro' : 'pomodoros';
    return ` · ${formatMinutes(minutes)} (${pomodoros} ${word})`;
}

/** Returns {minutes, pomodoros} for a logged line, or null if it has no suffix. */
export function parseSuffix(line) {
    const m = SUFFIX_RE.exec(line);
    if (!m)
        return null;
    return {minutes: parseDuration(m[1]), pomodoros: parseInt(m[2], 10)};
}

export function stripSuffix(line) {
    return line.replace(SUFFIX_RE, '');
}

/* ----------------------------------------------------------------- sections */

export function normalise(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Locates "### Focus & Objectives" and the extent of its body. */
export function findFocusSection(text) {
    const lines = text.split('\n');
    let headingIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (HEADING_RE.test(lines[i])) {
            headingIndex = i;
            break;
        }
    }
    if (headingIndex === -1)
        return null;

    let bodyEnd = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i++) {
        if (ANY_HEADING_RE.test(lines[i])) {
            bodyEnd = i;
            break;
        }
    }
    return {lines, headingIndex, bodyEnd};
}

export function hasFocusSection(text) {
    return text.split('\n').some(line => HEADING_RE.test(line));
}

export function ensureFocusSection(text) {
    if (hasFocusSection(text))
        return text;
    const sep = text === '' || text.endsWith('\n') ? '' : '\n';
    return `${text}${sep}\n${FOCUS_HEADING}\n`;
}

/* ----------------------------------------------------------------- matching */

/**
 * task = {label, matchKey}
 * - matchKey set (Jira key): any list item mentioning the key counts.
 * - tag label (#foo): any whitespace-delimited token of the item equals it, so
 *   "#research" matches "#research RabbitMQ vs Kafka".
 * - plain label: the item text must equal the label.
 * An already-logged " · 25m (1 pomodoro)" suffix never affects the comparison,
 * otherwise a second pomodoro would append a duplicate line instead of
 * incrementing the first.
 */
function matchesTask(bare, task) {
    const text = stripSuffix(bare).trim();
    if (task.matchKey)
        return text.toLowerCase().includes(task.matchKey.toLowerCase());
    const target = normalise(task.label);
    if (task.label.startsWith('#')) {
        return text.split(/\s+/).some(token => normalise(token) === target);
    }
    return normalise(text) === target;
}

/* ------------------------------------------------------------------- upsert */

/**
 * Adds time to the line for `task` under "### Focus & Objectives", creating it
 * if absent. Existing lines keep their own wording, indent and checkbox state;
 * only the " · 25m (1 pomodoro)" suffix is added or incremented.
 */
export function upsertFocusEntry(text, task, addMinutes, addPomodoros) {
    const source = ensureFocusSection(text);
    const {lines, headingIndex, bodyEnd} = findFocusSection(source);

    let matchIndex = -1;
    for (let i = headingIndex + 1; i < bodyEnd; i++) {
        const item = LIST_ITEM_RE.exec(lines[i]);
        if (item && matchesTask(item[4].trim(), task)) {
            matchIndex = i;
            break;
        }
    }

    if (matchIndex >= 0) {
        const previous = parseSuffix(lines[matchIndex]);
        const minutes = (previous?.minutes ?? 0) + addMinutes;
        const pomodoros = (previous?.pomodoros ?? 0) + addPomodoros;
        lines[matchIndex] =
            stripSuffix(lines[matchIndex]).trimEnd() + formatSuffix(minutes, pomodoros);
        return lines.join('\n');
    }

    const newLine = `- [ ] ${task.label}${formatSuffix(addMinutes, addPomodoros)}`;
    let lastNonBlank = -1;
    for (let i = headingIndex + 1; i < bodyEnd; i++) {
        if (lines[i].trim() !== '')
            lastNonBlank = i;
    }
    // An empty section takes the entry on the line directly under its heading;
    // otherwise the entry goes below the last item already in the section.
    const insertAt = lastNonBlank >= 0 ? lastNonBlank + 1 : headingIndex + 1;

    lines.splice(insertAt, 0, newLine);
    return lines.join('\n');
}

/* --------------------------------------------------------------- frontmatter */

/** Rewrites the `modified:` frontmatter field in place, if the note has one. */
export function updateModifiedFrontmatter(text, stamp) {
    if (!text.startsWith('---\n'))
        return text;
    const close = text.indexOf('\n---', 4);
    if (close === -1)
        return text;
    const head = text.slice(0, close);
    if (!/^modified:.*$/m.test(head))
        return text;
    return head.replace(/^modified:.*$/m, `modified: ${stamp}`) + text.slice(close);
}

/* ------------------------------------------------------------- daily note IO */

export function dailyNoteBody(date, time, template) {
    if (template && template.trim() !== '') {
        return template
            .replaceAll('{{date}}', date)
            .replaceAll('{{time}}', time)
            .replaceAll('{{title}}', '');
    }
    return [
        `## Daily Log — ${date}`,
        '',
        FOCUS_HEADING,
        '',
        '### Research & Discoveries',
        '',
        '-',
        '',
        '### Fleeting Notes Captured',
        '',
        '-',
        '',
        '### Tasks & Follow-ups',
        '',
        '- [ ]',
        '',
    ].join('\n');
}

/** Builds a daily note matching the vault's own conventions. */
export function renderDailyNote({date, time, longDate, template}) {
    const frontmatter = [
        '---',
        `id: "${date}"`,
        'aliases:',
        `  - ${longDate}`,
        'tags:',
        '  - daily-notes',
        `created: ${date} ${time}`,
        `modified: ${date} ${time}`,
        'title: ""',
        '---',
        '',
    ].join('\n');
    const body = dailyNoteBody(date, time, template);
    return `${frontmatter}${body.replace(/^\n+/, '')}`.replace(/\n*$/, '\n');
}
