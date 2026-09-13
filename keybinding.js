import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

// from https://stackoverflow.com/questions/12325405/gnome-shell-extension-key-binding

export const KeyboardShortcuts = class {
  constructor() {
    this._grabbers = {};
    this._eventId = null;
  }

  enable() {
    this._grabbers = {};
    if (this._eventId) return;
    try {
      this._eventId = global.display.connect(
        'accelerator-activated',
        (display, action, deviceId, timestamp) => {
          this._onAccelerator(action);
        },
      );
    } catch (err) {
      console.log(`search-light: cannot watch accelerators: ${err}`);
      this._eventId = null;
    }
  }

  disable() {
    try {
      this.unlisten();
    } catch (err) {
      console.log(`search-light: accelerator unlisten failed: ${err}`);
    }
    if (this._eventId) {
      try {
        global.display.disconnect(this._eventId);
      } catch {
        // Already disconnected during session teardown.
      }
      this._eventId = null;
    }
  }

  listenFor(accelerator, callback) {
    if (!accelerator) return;
    let action = Meta.KeyBindingAction.NONE;
    try {
      action = global.display.grab_accelerator(accelerator, 0);
    } catch (err) {
      console.log(`search-light: grab ${accelerator} failed: ${err}`);
      return;
    }
    if (action === Meta.KeyBindingAction.NONE) {
      console.log(`Unable to grab accelerator ${accelerator}`);
      return;
    }

    let name = Meta.external_binding_name_for_action(action);
    try {
      Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);
    } catch (err) {
      console.log(`search-light: allowKeybinding ${name} failed: ${err}`);
      try {
        global.display.ungrab_accelerator(action);
      } catch {
        // Best effort cleanup.
      }
      return;
    }

    this._grabbers[action] = {
      name,
      accelerator,
      callback,
    };

    console.log(`Grabbed ${accelerator}`);
  }

  unlisten() {
    if (this._grabbers) {
      Object.keys(this._grabbers).forEach((k) => {
        const action = Number(k);
        const grabber = this._grabbers[k];
        // Object.keys() yields strings; ungrab_accelerator needs the
        // numeric action id — passing the string silently leaks the grab.
        try {
          if (grabber?.name) {
            Main.wm.removeKeybinding(grabber.name);
          }
        } catch {
          // Keybinding already removed.
        }
        try {
          global.display.ungrab_accelerator(action);
        } catch {
          // Accelerator already released.
        }
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
