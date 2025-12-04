import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

// from https://stackoverflow.com/questions/12325405/gnome-shell-extension-key-binding

export const KeyboardShortcuts = class {
  constructor() {}

  enable() {
    this._grabbers = {};
    this._eventId = global.display.connect(
      'accelerator-activated',
      (display, action, deviceId, timestamp) => {
        this._onAccelerator(action);
      }
    );
  }

  disable() {
    this.unlisten();
    global.display.disconnect(this._eventId);
  }

  listenFor(accelerator, callback) {
    let action = global.display.grab_accelerator(accelerator, 0);
    if (action == Meta.KeyBindingAction.NONE) {
      console.log(`Unable to grab accelerator ${accelerator}`);
      return;
    }

    let name = Meta.external_binding_name_for_action(action);
    Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

    this._grabbers[action] = {
      name: name,
      accelerator: accelerator,
      callback: callback,
    };

    console.log(`Grabbed ${accelerator}`);
  }

  unlisten() {
    if (this._grabbers) {
      Object.keys(this._grabbers).forEach((k) => {
        Main.wm.removeKeybinding(this._grabbers[k].name, Shell.ActionMode.ALL);
        // what the post in stackoverflow doesn't show is proper clean.. ungrab!
        global.display.ungrab_accelerator(k);
      });
    }
    this._grabbers = {};
  }

  _onAccelerator(action) {
    let grabber = this._grabbers[action];

    if (grabber) {
      grabber.callback();
    } else {
      console.log(`No listeners ${action}`);
    }
  }
};
