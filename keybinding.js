const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// from https://stackoverflow.com/questions/12325405/gnome-shell-extension-key-binding

var KeyboardShortcuts = class KeyboardShortcuts {
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
      log(`Unable to grab accelerator ${accelerator}`);
      return;
    }

    let name = Meta.external_binding_name_for_action(action);
    Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

    this._grabbers[action] = {
      name: name,
      accelerator: accelerator,
      callback: callback,
    };

    log(`Grabbed ${accelerator}`);
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
      log(`No listeners ${action}`);
    }
  }
};
