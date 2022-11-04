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
 */

/* exported init */

const GETTEXT_DOMAIN = 'search-light';

const { GObject, St } = imports.gi;

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
    });
    Object.keys(SettingsKeys._keys).forEach((k) => {
      let key = SettingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
    });

    this.container = new St.BoxLayout({
      name: 'searchLightContainer',
      vertical: true,
    });
    this.hide();
    this.container._delegate = this;
    this.container.reactive = true;
    this.container.can_focus = true;
    this.container.track_hover = true;

    Main.uiGroup.add_child(this.container);

    // this._acquire_ui();

    this.accel = new KeyboardShortcuts();
    this.accel.enable();

    // this.accel.listenFor('<super>Space', this._toggle_search_light.bind(this));
    this.accel.listenFor(
      '<ctrl><super>Space',
      this._toggle_search_light.bind(this)
    );

    if (!this._inOverview) {
      this._overViewEvents = [];
      this._overViewEvents.push(
        Main.overview.connect('showing', this._onOverviewShowing.bind(this))
      );
      this._overViewEvents.push(
        Main.overview.connect('hidden', this._onOverviewHidden.bind(this))
      );
    }

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

    if (this._overViewEvents && !this._inOverview) {
      this._overViewEvents.forEach((id) => {
        Main.overview.disconnect(id);
      });
      this._overViewEvents = [];
    }

    clearAllTimers();
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

    this.scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

    this._entry = Main.overview.searchEntry;
    this._entryParent = this._entry.get_parent();

    this._search = Main.uiGroup.find_child_by_name('searchController');
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();

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

    this.container.hide();

    if (Main.overview._toggle) {
      Main.overview.toggle = Main.overview._toggle;
      Main.overview._toggle = null;
    }
  }

  _queryDisplay() {
    this.monitor = Main.layoutManager.primaryMonitor;
    this.sw = this.monitor.width;
    this.sh = this.monitor.height;
  }

  _compute_size() {
    this._queryDisplay();
    this.width = 600 + (this.sw / 2) * (this.scale_width || 0);
    this.height = 400 + (this.sh / 2) * (this.scale_height || 0);
    this.initial_height = 20 + Main._searchLight._search._text.height * 2;
    let x = this.sw / 2 - this.width / 2;
    let y = this.sh / 2 - this.height / 2;
    this._visible = true;
    this.container.set_size(this.width, this.initial_height);
    this.container.set_position(x, y);
  }

  show() {
    this._acquire_ui();
    this._update_css();
    this._compute_size();
    this.container.show();

    beginTimer(
      runOneShot(() => {
        this._compute_size();
      }, 0)
    );

    this._add_events();
  }

  hide() {
    this._visible = false;
    this.container.hide();
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
        this.container.add_style_class_name(`border-radius-${r}`);
      }
      for (let i = 0; i < 8; i++) {
        if (i != r) {
          this.container.remove_style_class_name(`border-radius-${i}`);
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
    this._stageEvents = [];
    this._stageEvents.push(
      global.stage.connect(
        'notify::key-focus',
        this._onKeyFocusChanged.bind(this)
      )
    );

    this._displayEvents = [];
    this._displayEvents.push(
      global.display.connect(
        'notify::focus-window',
        this._onFocusWindow.bind(this)
      )
    );
    this._displayEvents.push(
      global.display.connect(
        'in-fullscreen-changed',
        this._onFullScreen.bind(this)
      )
    );
  }

  _remove_events() {
    if (this._displayEvents) {
      this._displayEvents.forEach((id) => {
        global.display.disconnect(id);
      });
    }
    this._displayEvents = [];

    if (this._stageEvents) {
      this._stageEvents.forEach((id) => {
        global.stage.disconnect(id);
      });
    }
    this._stageEvents = [];
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

  _onFullScreen() {
    this.hide();
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}
