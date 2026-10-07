import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PomodoroObsidianPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(this._vaultPage(settings));
        window.add(this._timerPage(settings));
        window.add(this._musicPage(settings));
    }

    _vaultPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Obsidian',
            icon_name: 'document-edit-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Daily notes',
            description: 'Finished focus phases are written under the ' +
                '"### Focus & Objectives" heading of the daily note. The Work ' +
                'and Personal fields in the panel menu decide which vault each ' +
                'phase is logged to; a phase with both filled is logged to both.',
        });
        page.add(group);

        const root = new Adw.EntryRow({
            title: 'Vault root',
            text: settings.get_string('vault-root'),
        });
        root.connect('changed', () => settings.set_string('vault-root', root.text));
        group.add(root);

        return page;
    }

    _timerPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Timer',
            icon_name: 'alarm-symbolic',
        });

        const lengths = new Adw.PreferencesGroup({title: 'Lengths'});
        page.add(lengths);
        lengths.add(this._minutesRow(settings, 'work-minutes', 'Focus', 180));
        lengths.add(this._minutesRow(settings, 'short-break-minutes', 'Short break', 60));
        lengths.add(this._minutesRow(settings, 'long-break-minutes', 'Long break', 120));
        lengths.add(this._minutesRow(settings, 'pomodoros-per-set',
            'Focus phases per long break', 12));

        const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
        page.add(behaviour);
        behaviour.add(this._switchRow(settings, 'auto-start-breaks', 'Start breaks automatically'));
        behaviour.add(this._switchRow(settings, 'auto-start-work', 'Start focus automatically'));
        behaviour.add(this._switchRow(settings, 'notify', 'Notify when a phase ends'));

        return page;
    }

    _musicPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Lofi',
            icon_name: 'audio-headphones-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Stream',
            description: 'Played by mpv. It starts with a focus phase and stops ' +
                'when the extension is disabled.',
        });
        page.add(group);

        group.add(this._switchRow(settings, 'music-enabled',
            'Stream during focus phases'));

        const url = new Adw.EntryRow({
            title: 'Stream URL',
            text: settings.get_string('music-url'),
        });
        url.connect('changed', () => settings.set_string('music-url', url.text));
        group.add(url);

        const volume = new Adw.SpinRow({
            title: 'Volume',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5}),
            value: settings.get_int('music-volume'),
        });
        volume.connect('notify::value', () =>
            settings.set_int('music-volume', Math.round(volume.value)));
        group.add(volume);

        return page;
    }

    /* ------------------------------------------------------------------ rows */

    _minutesRow(settings, key, title, upper) {
        const row = new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({lower: 1, upper, step_increment: 1}),
            value: settings.get_int(key),
        });
        row.connect('notify::value', () =>
            settings.set_int(key, Math.round(row.value)));
        return row;
    }

    _switchRow(settings, key, title) {
        const row = new Adw.SwitchRow({
            title,
            active: settings.get_boolean(key),
        });
        row.connect('notify::active', () => settings.set_boolean(key, row.active));
        return row;
    }
}
