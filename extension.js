/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
/

/* exported init */

const GETTEXT_DOMAIN = 'search-light';

const { GObject, St, Clutter, Shell, Meta } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const Me = ExtensionUtils.getCurrentExtension();
const { schemaId, settingsKeys, SettingsKeys } = Me.imports.preferences.keys;

const KeyboardShortcuts = Me.imports.keybinding.KeyboardShortcuts;

const runSequence = Me.imports.utils.runSequence;
const runOneShot = Me.imports.utils.runOneShot;
const runLoop = Me.imports.utils.runLoop;
const beginTimer = Me.imports.utils.beginTimer;
const clearAllTimers = Me.imports.utils.clearAllTimers;
const getRunningTimers = Me.imports.utils.getRunningTimers;

const _ = ExtensionUtils.gettext;

class Extension {
  constructor(uuid) {
    this._uuid = uuid;

    ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
  }

  enable() {
    Main._searchLight = this;

    this._settings = ExtensionUtils.getSettings(schemaId);
    this._settingsKeys = SettingsKeys;

    SettingsKeys.connectSettings(this._settings, (name, value) => {
      let n = name.replace(/-/g, '_');
      this[n] = value;
      switch (name) {
        case 'shortcut-search':
          this._updateShortcut();
          break;
      }
    });
    Object.keys(SettingsKeys._keys).forEach((k) => {
      let key = SettingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
      // log(`${name} ${key.value}`);
    });

    this.mainContainer = new St.Widget({
      name: 'searchLight',
      offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
      layout_manager: new Clutter.BinLayout(),
    });
    this.container = new St.BoxLayout({
      name: 'searchLightBox',
      vertical: true,
      reactive: true,
      track_hover: true,
      can_focus: true,
    });
    this.hide();
    this.container._delegate = this;
    Main.uiGroup.add_child(this.mainContainer);

    this.mainContainer.add_child(this.container);

    this._bgActor = new Meta.BackgroundActor();
    let background = Main.layoutManager._backgroundGroup.get_child_at_index(0);
    this._bgActor.set_content(background.get_content());
    let background_parent = new St.Widget({
      name: 'searchLightBlurredBackground',
      layout_manager: new Clutter.BinLayout(),
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      effect: new Shell.BlurEffect({
        name: 'blur',
        brightness: 1.0,
        sigma: 100,
        mode: Shell.BlurMode.ACTOR,
      }),
    });
    
    background_parent.add_child(this._bgActor);
    this._bgActor.clip_to_allocation = true;
    this._bgActor.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
      background_parent.opacity = 255;
      
    this.mainContainer.insert_child_below(background_parent, this.container);
    this._background = background_parent;
    this._background.visible = false;

    this.accel = new KeyboardShortcuts();
    this.accel.enable();

    this._updateShortcut();

    Main.overview.connectObject(
      'overview-showing',
      this._onOverviewShowing.bind(this),
      'overview-hidden',
      this._onOverviewHidden.bind(this),
      this
    );

    log('enabled');
  }

  disable() {
    SettingsKeys.disconnectSettings();
    this._settings = null;

    if (this.accel) {
      this.accel.disable();
      delete this.accel;
      this.accel = null;
    }

    // this will release the ui
    this.hide();

    if (this.container) {
      this.container.get_parent().remove_child(this.container);
      this.container.destroy();
      this.container = null;
    }

    clearAllTimers();
  }

  _updateShortcut(disable) {
    this.accel.unlisten();

    let shortcut = '';
    try {
      shortcut = (this.shortcut_search || []).join('');
    } catch (err) {
      //
    }
    if (shortcut == '') {
      shortcut = '<Control><Super>Space';
    }

    if (!disable) {
      this.accel.listenFor(shortcut, this._toggle_search_light.bind(this));
    }
  }

  _queryDisplay() {
    let idx = this.preferred_monitor || 0;
    if (idx == 0) {
      idx = Main.layoutManager.primaryIndex;
    } else if (idx == Main.layoutManager.primaryIndex) {
      idx = 0;
    }
    this.monitor =
      Main.layoutManager.monitors[idx] || Main.layoutManager.primaryMonitor;

    if (this.popup_at_cursor_monitor) {
      let pointer = global.get_pointer();
      Main.layoutManager.monitors.forEach((m) => {
        if (
          pointer[0] >= m.x &&
          pointer[0] <= m.x + m.width &&
          pointer[1] >= m.y &&
          pointer[1] <= m.y + m.height
        ) {
          this.monitor = m;
        }
      });
    }

    this.sw = this.monitor.width;
    this.sh = this.monitor.height;

    if (this._last_monitor_count != Main.layoutManager.monitors.length) {
      this._settings.set_int(
        'monitor-count',
        Main.layoutManager.monitors.length
      );
      this._last_monitor_count = Main.layoutManager.monitors.length;
    }
  }

  _acquire_ui() {
    if (this._entry) return;

    if (!Main.overview._toggle) {
      Main.overview._toggle = Main.overview.toggle;
    }
    Main.overview.toggle = () => {
      if (this._search && this._search.visible) {
        this._search._text.get_parent().grab_key_focus();
      }
    };

    this._queryDisplay();

    this.scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

    this._entry = Main.overview.searchEntry;
    this._entryParent = this._entry.get_parent();
    this._entry.add_style_class_name('slc');

    this._search = Main.uiGroup.find_child_by_name('searchController');
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();
    this._resize_icons();

    if (this._entry.get_parent()) {
      this._entry.get_parent().remove_child(this._entry);
    }
    this.container.add_child(this._entry);
    if (this._search.get_parent()) {
      this._search.get_parent().remove_child(this._search);
    }
    this.container.add_child(this._search);
    if (!this._search.__searchCancelled) {
      this._search.__searchCancelled = this._search._searchCancelled;
      this._search._searchCancelled = () => {};
    }
    this._textChangedEventId = this._search._text.connect(
      'text-changed',
      () => {
        this.container.set_size(this.width, this.height);
        this.mainContainer.set_size(this.width, this.height);
        this._resize_icons();
        this._search.show();
      }
    );
  }

  _release_ui() {
    if (this._entry) {
      this._entry.get_parent().remove_child(this._entry);
      this._entryParent.add_child(this._entry);
      this._entry = null;
    }

    if (this._search) {
      this._search.hide();
      this._search.get_parent().remove_child(this._search);
      this._searchParent.add_child(this._search);
      if (this._textChangedEventId) {
        this._search._text.disconnect(this._textChangedEventId);
        this._textChangedEventId = null;
      }
      if (this._search.__searchCancelled) {
        this._search._searchCancelled = this._search.__searchCancelled;
        this._search.__searchCancelled = null;
      }
      this._search = null;
    }

    this.mainContainer.hide();

    if (Main.overview._toggle) {
      Main.overview.toggle = Main.overview._toggle;
      Main.overview._toggle = null;
    }
  }

  _resize_icons() {
    if (this._entry) {
      this._entry.get_children().forEach((c) => {
        if (c.style_class == 'search-entry-icon') {
          c.set_icon_size(28);
        } else {
          c.style = 'font-size: 18pt';
        }
      });
    }
  }

  _compute_size() {
    this._queryDisplay();

    // container size
    this.width =
      600 + ((this.sw * this.scaleFactor) / 2) * (this.scale_width || 0);
    this.height =
      400 + ((this.sh * this.scaleFactor) / 2) * (this.scale_height || 0);

    // text size
    Main._searchLight._search._text.height = 44 * this.scaleFactor;
    Main._searchLight._search._text.get_parent().height = 50 * this.scaleFactor;

    // initial height
    this.initial_height = 44 * 2 * this.scaleFactor;

    // position
    let x = this.sw / 2 - this.width / 2;
    let y = this.sh / 2 - this.height / 2;
    this._visible = true;

    // this.container.set_size(this.width, this.initial_height);
    // this.container.set_position(this.monitor.x + x, this.monitor.y + y);

    this.container.set_size(this.width, this.initial_height);
    this.mainContainer.set_size(this.width, this.initial_height);
    this.mainContainer.set_position(this.monitor.x + x, this.monitor.y + y);

    // background
    if (this._background) {
      // this._background.set_position(this.monitor.x - x, this.monitor.y - y);
      this._background.set_position(0, 0);
      this._background.set_size(this.monitor.width, this.monitor.height);
      this._background.show();
    }
  }

  show() {
    this._acquire_ui();
    this._update_css();
    this._compute_size();
    this.mainContainer.show();

    beginTimer(
      runOneShot(() => {
        this._compute_size();
      }, 0)
    );

    this._add_events();
  }

  hide() {
    this._visible = false;
    this.mainContainer.hide();
    this._release_ui();
    this._remove_events();
  }

  _update_css(disable) {
    let bg = this.background_color || [0, 0, 0, 0.5];
    let clr = bg.map((r) => Math.floor(255 * r));
    clr[3] = bg[3];
    this.container.style = `background: rgba(${clr.join(',')})`;

    if (this.border_radius !== null) {
      let r = -1;
      if (!disable) {
        r = Math.floor(this.border_radius);
        this.mainContainer.add_style_class_name(`border-radius-${r}`);
      }
      for (let i = 0; i < 8; i++) {
        if (i != r) {
          this.mainContainer.remove_style_class_name(`border-radius-${i}`);
        }
      }
    }

    if (0.3 * bg[0] + 0.59 * bg[1] + 0.11 * bg[2] < 0.5) {
      this.container.remove_style_class_name('light');
    } else {
      this.container.add_style_class_name('light');
    }
  }

  _toggle_search_light() {
    if (this._inOverview) return;
    if (!this._visible) {
      this.show();
      global.stage.set_key_focus(this._entry);
    }
  }

  _add_events() {
    global.stage.connectObject(
      'notify::key-focus',
      this._onKeyFocusChanged.bind(this),
      'key-press-event',
      this._onKeyPressed.bind(this),
      this
    );

    global.display.connectObject(
      'notify::focus-window',
      this._onFocusWindow.bind(this),
      'in-fullscreen-changed',
      this._onFullScreen.bind(this),
      this
    );
  }

  _remove_events() {
    global.display.disconnectObject(this);
    global.stage.disconnectObject(this);
    Main.overview.disconnectObject(this);
  }

  _onOverviewShowing() {
    this._inOverview = true;
  }

  _onOverviewHidden() {
    this._inOverview = false;
  }

  _onFocusWindow(w, e) {}

  _onKeyFocusChanged() {
    if (!this._entry) return;
    let focus = global.stage.get_key_focus();
    let appearFocused =
      this._entry.contains(focus) || this._searchResults.contains(focus);
    if (!appearFocused) {
      this.hide();
    }
  }

  _onKeyPressed(obj, evt) {
    let focus = global.stage.get_key_focus();
    if (!this._entry.contains(focus)) {
      this._search._text.get_parent().grab_key_focus();
    }
    return Clutter.EVENT_STOP;
  }

  _onFullScreen() {
    this.hide();
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}
