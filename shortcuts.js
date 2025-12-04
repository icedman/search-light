// https://github.com/eonpatapon/gnome-shell-extension-caffeine

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

const genParam = (type, name, ...dflt) =>
  GObject.ParamSpec[type](
    name,
    name,
    name,
    GObject.ParamFlags.READWRITE,
    ...dflt
  );

const _ = (t) => t;

export let ShortcutSettingWidget = class extends Gtk.Button {
  static {
    GObject.registerClass(
      {
        Properties: {
          shortcut: genParam('string', 'shortcut', ''),
        },
        Signals: {
          changed: { param_types: [GObject.TYPE_STRING] },
        },
      },
      this
    );
  }

  constructor(content, settings, key, window) {
    super({ valign: Gtk.Align.CENTER, has_frame: false });
    this._key = key;
    this._settings = settings;
    this.window = window;

    this.content = content;
    this.connect('clicked', this._onActivated.bind(this));

    let label = new Gtk.ShortcutLabel({ disabled_text: _('New accelerator…') });
    this._label = label;
    this.set_child(label);

    this.bind_property(
      'shortcut',
      label,
      'accelerator',
      GObject.BindingFlags.DEFAULT
    );
    [this.shortcut] = this._settings.get_strv(this._key);
  }

  _onActivated(widget) {
    let ctl = new Gtk.EventControllerKey();

    if (!this._editor) {
      this._editor = new Gtk.Window({
        title: 'Accelerator',
        modal: true,
        hide_on_close: true,
        transient_for: widget.get_root(),
        width_request: 480,
        height_request: 320,
        child: this.content,
      });
    }

    this._editor.add_controller(ctl);
    ctl.connect('key-pressed', this._onKeyPressed.bind(this));
    this._editor.present();
  }

  _onKeyPressed(_widget, keyval, keycode, state) {
    let mask = state & Gtk.accelerator_get_default_mod_mask();
    mask &= ~Gdk.ModifierType.LOCK_MASK;

    if (!mask && keyval === Gdk.KEY_Escape) {
      this._editor.close();
      return Gdk.EVENT_STOP;
    }

    if (keyval === Gdk.KEY_BackSpace) {
      this.saveShortcut(); // Clear shortcut
      return Gdk.EVENT_STOP;
    }

    if (
      !this.isValidBinding(mask, keycode, keyval) ||
      !this.isValidAccel(mask, keyval)
    ) {
      return Gdk.EVENT_STOP;
    }

    this.saveShortcut(keyval, keycode, mask);
    return Gdk.EVENT_STOP;
  }

  saveShortcut(keyval, keycode, mask) {
    if (!keyval && !keycode) {
      this.shortcut = '';
    } else {
      this.shortcut = Gtk.accelerator_name_with_keycode(
        null,
        keyval,
        keycode,
        mask
      );
    }

    console.log('saved new shortcut');

    this.emit('changed', this.shortcut);
    this._settings.set_strv(this._key, [this.shortcut]);
    // this._editor.destroy();
    this._editor.close();
  }

  // Functions from https://gitlab.gnome.org/GNOME/gnome-control-center/-/blob/main/panels/keyboard/keyboard-shortcuts.c

  keyvalIsForbidden(keyval) {
    return [
      // Navigation keys
      Gdk.KEY_Home,
      Gdk.KEY_Left,
      Gdk.KEY_Up,
      Gdk.KEY_Right,
      Gdk.KEY_Down,
      Gdk.KEY_Page_Up,
      Gdk.KEY_Page_Down,
      Gdk.KEY_End,
      Gdk.KEY_Tab,

      // Return
      Gdk.KEY_KP_Enter,
      Gdk.KEY_Return,

      Gdk.KEY_Mode_switch,
    ].includes(keyval);
  }

  isValidBinding(mask, keycode, keyval) {
    return !(
      mask === 0 ||
      (mask === Gdk.SHIFT_MASK &&
        keycode !== 0 &&
        ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
          (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
          (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
          (keyval >= Gdk.KEY_kana_fullstop &&
            keyval <= Gdk.KEY_semivoicedsound) ||
          (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
          (keyval >= Gdk.KEY_Serbian_dje &&
            keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
          (keyval >= Gdk.KEY_Greek_ALPHAaccent &&
            keyval <= Gdk.KEY_Greek_omega) ||
          (keyval >= Gdk.KEY_hebrew_doublelowline &&
            keyval <= Gdk.KEY_hebrew_taf) ||
          (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
          (keyval >= Gdk.KEY_Hangul_Kiyeog &&
            keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
          (keyval === Gdk.KEY_space && mask === 0) ||
          this.keyvalIsForbidden(keyval)))
    );
  }

  isValidAccel(mask, keyval) {
    return (
      Gtk.accelerator_valid(keyval, mask) ||
      (keyval === Gdk.KEY_Tab && mask !== 0)
    );
  }
};
