// Panel button, drop-down menu and pomodoro state machine.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Music} from './music.js';
import {VAULTS, logPomodoro} from './vault.js';
import {parseTaskInput, serialiseTasks} from './task-parse.js';

const PHASE = {WORK: 'work', BREAK: 'break', LONG_BREAK: 'long-break'};

const PHASE_TITLE = {
    [PHASE.WORK]: 'Focus',
    [PHASE.BREAK]: 'Short break',
    [PHASE.LONG_BREAK]: 'Long break',
};

const VAULT_LABEL = {work: 'Work', personal: 'Personal'};

const VAULT_HINT = {
    work: 'UPES-2952, UPES-2953',
    personal: 'taxes, #reading, write the docs',
};

function formatClock(seconds) {
    const total = Math.max(0, seconds);
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export const PomodoroIndicator = GObject.registerClass(
    {GTypeName: 'PomodoroObsidianIndicator'},
    class PomodoroIndicator extends PanelMenu.Button {
        _init(settings, extension) {
            super._init(0.5, 'Pomodoro Obsidian');

            this._settings = settings;
            this._extension = extension;
            this._music = new Music();
            this._timeout = 0;
            this._deadline = 0;
            this._remaining = this._workSeconds();
            this._phase = PHASE.WORK;
            this._running = false;
            this._completed = 0;

            this._taskEntries = {};
            this._buildPanel();
            this._buildMenu();
            this._refresh();

            this._settingsIds = [
                ...VAULTS.map(vault => this._settings.connect(
                    `changed::${vault}-tasks`, () => this._refreshTasks())),
                this._settings.connect('changed::work-minutes', () => this._resetIfIdle()),
            ];
        }

        /* ------------------------------------------------------------ settings */

        _workSeconds() {
            return this._settings.get_int('work-minutes') * 60;
        }

        _phaseSeconds() {
            switch (this._phase) {
            case PHASE.BREAK:
                return this._settings.get_int('short-break-minutes') * 60;
            case PHASE.LONG_BREAK:
                return this._settings.get_int('long-break-minutes') * 60;
            default:
                return this._workSeconds();
            }
        }

        /** The tasks typed into one vault's field, e.g. _tasks('work'). */
        _tasks(vault) {
            return parseTaskInput(this._settings.get_string(`${vault}-tasks`));
        }

        _resetIfIdle() {
            if (!this._running && this._phase === PHASE.WORK) {
                this._remaining = this._workSeconds();
                this._refresh();
            }
        }

        /* ------------------------------------------------------------- widgets */

        _buildPanel() {
            const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});

            this._panelIcon = new St.Icon({
                icon_name: 'alarm-symbolic',
                style_class: 'system-status-icon',
            });
            this._panelLabel = new St.Label({
                text: formatClock(this._remaining),
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'pomodoro-panel-label',
            });

            box.add_child(this._panelIcon);
            box.add_child(this._panelLabel);
            this.add_child(box);
        }

        _buildMenu() {
            this._statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false});
            const statusBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._statusLabel = new St.Label({style_class: 'pomodoro-status-label'});
            this._tasksLabel = new St.Label({style_class: 'pomodoro-tasks-label'});
            statusBox.add_child(this._statusLabel);
            statusBox.add_child(this._tasksLabel);
            this._statusItem.add_child(statusBox);
            this.menu.addMenuItem(this._statusItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._buildTaskRows();

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(this._buildControlsRow());

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._musicItem = new PopupMenu.PopupSwitchMenuItem('Lofi stream', false);
            // Toggling the stream shouldn't dismiss the menu. Chaining to
            // super.activate() is what closes it, so don't. GNOME's own
            // space-key path returns before that call for this same reason.
            this._musicItem.activate = function () {
                this.toggle();
            };
            this._musicItem.connect('toggled', (_item, active) => {
                if (active)
                    this._music.play(this._musicUrl(), this._musicVolume());
                else
                    this._music.pause();
            });
            this.menu.addMenuItem(this._musicItem);

            const prefsItem = new PopupMenu.PopupMenuItem('Preferences');
            prefsItem.connect('activate', () => this._extension.openPreferences());
            this.menu.addMenuItem(prefsItem);
        }

        /**
         * One field per vault. Each writes only its own vault, so filling both
         * and letting a phase run logs the phase into both daily notes.
         */
        _buildTaskRows() {
            for (const vault of VAULTS) {
                const item = new PopupMenu.PopupBaseMenuItem();
                // Enter belongs to the entry, not to the menu.
                item.activate = () => {};

                const box = new St.BoxLayout({
                    x_expand: true,
                    style_class: 'pomodoro-tasks-row',
                });
                box.add_child(new St.Label({
                    text: VAULT_LABEL[vault],
                    style_class: 'pomodoro-vault-label',
                    y_align: Clutter.ActorAlign.CENTER,
                }));

                const entry = new St.Entry({
                    style_class: 'pomodoro-task-entry',
                    hint_text: VAULT_HINT[vault],
                    can_focus: true,
                    x_expand: true,
                });
                entry.clutter_text.connect('activate', () => {
                    this._settings.set_string(`${vault}-tasks`,
                        serialiseTasks(parseTaskInput(entry.get_text())));
                    this.menu.close();
                });
                box.add_child(entry);
                item.add_child(box);

                this.menu.addMenuItem(item);
                this._taskEntries[vault] = entry;
            }
        }

        _buildControlsRow() {
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
            const box = new St.BoxLayout({x_expand: true, x_align: Clutter.ActorAlign.CENTER});

            this._toggleButton = this._controlButton('media-playback-start-symbolic',
                'Start or pause', () => this.toggle());
            this._skipButton = this._controlButton('media-skip-forward-symbolic',
                'Skip this phase', () => this.skip());
            this._resetButton = this._controlButton('view-refresh-symbolic',
                'Reset the timer and the pomodoro count', () => this.reset());

            box.add_child(this._toggleButton);
            box.add_child(this._skipButton);
            box.add_child(this._resetButton);
            item.add_child(box);
            return item;
        }

        _controlButton(iconName, accessibleName, onClick) {
            const button = new St.Button({
                style_class: 'button',
                can_focus: true,
                child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
            });
            button.accessible_name = accessibleName;
            button.connect('clicked', onClick);
            return button;
        }

        _musicUrl() {
            const url = this._settings.get_string('music-url').trim();
            return url === '' ? undefined : url;
        }

        _musicVolume() {
            return this._settings.get_int('music-volume');
        }

        /* ------------------------------------------------------- state machine */

        toggle() {
            this._running ? this.pause() : this.start();
        }

        start() {
            if (this._running)
                return;
            if (this._remaining <= 0)
                this._remaining = this._phaseSeconds();
            this._running = true;
            this._deadline = GLib.get_monotonic_time() + this._remaining * 1_000_000;
            this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => this._tick());
            if (this._phase === PHASE.WORK && this._settings.get_boolean('music-enabled')) {
                this._music.play(this._musicUrl(), this._musicVolume());
                this._musicItem.setToggleState(this._music.playing);
            }
            this._refresh();
        }

        pause() {
            if (!this._running)
                return;
            this._remaining = this._secondsLeft();
            this._stopTicking();
            this._running = false;
            this._refresh();
        }

        /** Ends the current phase early, crediting only the whole minutes spent. */
        skip() {
            const elapsed = this._phaseSeconds() - (this._running ? this._secondsLeft() : this._remaining);
            this._finishPhase(elapsed, false);
        }

        reset() {
            this._stopTicking();
            this._running = false;
            this._completed = 0;
            this._phase = PHASE.WORK;
            this._remaining = this._workSeconds();
            this._refresh();
        }

        _secondsLeft() {
            return Math.max(0, Math.round((this._deadline - GLib.get_monotonic_time()) / 1_000_000));
        }

        _tick() {
            this._remaining = this._secondsLeft();
            if (this._remaining > 0) {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
            // The source is being removed by this return; forget it before
            // _finishPhase possibly starts the next phase.
            this._timeout = 0;
            this._finishPhase(this._phaseSeconds(), true);
            return GLib.SOURCE_REMOVE;
        }

        _finishPhase(elapsedSeconds, completed) {
            this._stopTicking();
            this._running = false;

            if (this._phase === PHASE.WORK) {
                this._logWork(elapsedSeconds, completed);
                // Breaks are silent; the stream resumes with the next work
                // phase via start().
                this._music.pause();
                this._completed += 1;
                const perSet = this._settings.get_int('pomodoros-per-set');
                this._phase = this._completed % perSet === 0 ? PHASE.LONG_BREAK : PHASE.BREAK;
            } else {
                this._phase = PHASE.WORK;
            }

            this._remaining = this._phaseSeconds();

            if (this._settings.get_boolean('notify'))
                Main.notify('Pomodoro Obsidian', this._notificationText());

            const auto = this._phase === PHASE.WORK
                ? this._settings.get_boolean('auto-start-work')
                : this._settings.get_boolean('auto-start-breaks');
            // `auto` already picked the right key for the phase we just moved
            // into; testing the phase again here made breaks un-startable.
            if (auto)
                this.start();
            else
                this._refresh();
        }

        _notificationText() {
            if (this._phase !== PHASE.WORK) {
                return `${PHASE_TITLE[this._phase]} — next up, ${this._settings.get_int('short-break-minutes')} minutes.`;
            }
            const names = VAULTS.flatMap(vault => this._tasks(vault))
                .map(task => task.label).join(', ');
            return names === ''
                ? 'Focus time finished.'
                : `Focus time logged for ${names}.`;
        }

        /**
         * Writes the elapsed whole minutes to today's daily note. A phase the
         * user skipped is still recorded as time spent, but only a phase that
         * ran to the end counts as a pomodoro.
         */
        _logWork(elapsedSeconds, completed) {
            const minutes = Math.round(elapsedSeconds / 60);
            if (minutes < 1)
                return;

            for (const vault of VAULTS) {
                const tasks = this._tasks(vault);
                if (tasks.length === 0)
                    continue;
                // One vault failing to write must not cost us the other one.
                try {
                    logPomodoro(this._settings, vault, tasks, {
                        minutes,
                        pomodoros: completed ? 1 : 0,
                    });
                } catch (e) {
                    logError(e,
                        `pomodoro-obsidian: could not write the ${vault} daily note`);
                    Main.notifyError('Could not write to the Obsidian daily note',
                        `${vault}: ${e}`);
                }
            }
        }

        /* ------------------------------------------------------------- refresh */

        _refresh() {
            this._panelLabel.set_text(formatClock(this._remaining));
            this._panelIcon.icon_name = this._phase === PHASE.WORK
                ? 'alarm-symbolic'
                : 'media-playback-pause-symbolic';

            const phaseClass = this._phase === PHASE.WORK
                ? 'pomodoro-phase-work'
                : 'pomodoro-phase-break';
            this._statusLabel.set_text(
                `${PHASE_TITLE[this._phase]} · ${formatClock(this._remaining)}`);
            this._statusLabel.style_class = `pomodoro-status-label ${phaseClass}`;

            this._toggleButton.child.icon_name = this._running
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';

            this._refreshTasks();
        }

        _refreshTasks() {
            const filled = [];
            for (const vault of VAULTS) {
                const tasks = this._tasks(vault);

                // Never overwrite what the user is in the middle of typing.
                const entry = this._taskEntries[vault];
                if (!entry.clutter_text.has_key_focus())
                    entry.set_text(serialiseTasks(tasks));

                if (tasks.length > 0) {
                    filled.push(`${VAULT_LABEL[vault]}: ` +
                        tasks.map(task => task.label).join(', '));
                }
            }

            const count = this._completed;
            const suffix = count === 0 ? '' : ` · ${count} done this run`;
            this._tasksLabel.set_text(filled.length === 0
                ? `No task set — type one below${suffix}`
                : `${filled.join(' · ')}${suffix}`);
        }

        _stopTicking() {
            if (this._timeout !== 0) {
                GLib.source_remove(this._timeout);
                this._timeout = 0;
            }
        }

        destroy() {
            this._stopTicking();
            for (const id of this._settingsIds)
                this._settings.disconnect(id);
            this._settingsIds = [];
            this._music.stop();
            super.destroy();
        }
    });
