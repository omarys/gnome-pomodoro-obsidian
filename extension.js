import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PomodoroIndicator} from './lib/indicator.js';

export default class PomodoroObsidianExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new PomodoroIndicator(this._settings, this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
