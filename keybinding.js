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
    // Re-grabbing the same accelerator we already hold would leak the previous
    // action, so release first.
    this.unlisten();

    let action = global.display.grab_accelerator(accelerator, 0);
    if (action == Meta.KeyBindingAction.NONE) {
      console.log(`Unable to grab accelerator ${accelerator}`);
      return null;
    }

    let name = Meta.external_binding_name_for_action(action);
    Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

    this._grabbers[action] = {
      name: name,
      accelerator: accelerator,
      callback: callback,
    };

    console.log(`Grabbed ${accelerator}`);
    return action;
  }

  unlisten() {
    if (this._grabbers) {
      Object.keys(this._grabbers).forEach((k) => {
        const grabber = this._grabbers[k];
        // grabber.name is an "external-grab-N" name, which
        // Main.wm.removeKeybinding() cannot handle - it only removes
        // settings-backed bindings, so it returned FALSE and left the
        // allowKeybinding() entry behind while logging
        //   Trying to remove non-existent keybinding "external-grab-N"
        // Do the two things that actually apply to an external grab.
        Main.wm.allowKeybinding(grabber.name, Shell.ActionMode.NONE);
        global.display.ungrab_accelerator(parseInt(k, 10));
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
