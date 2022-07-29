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

const GETTEXT_DOMAIN = 'my-indicator-extension';

const { GObject, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const Me = ExtensionUtils.getCurrentExtension();

const KeyboardShortcuts = Me.imports.keybinding.KeyboardShortcuts;

const _ = ExtensionUtils.gettext;

class Extension {
  constructor(uuid) {
    this._uuid = uuid;

    ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
  }

  enable() {
    this.container = new St.BoxLayout({
      name: 'searchLightContainer',
      vertical: true,
    });
    this.container.add_style_class_name('dash');
    this.hide();
    this.container._delegate = this;

    Main.uiGroup.add_child(this.container);

    // this._acquire_ui();

    this.accel = new KeyboardShortcuts();
    this.accel.enable();

    this.accel.listenFor(
      '<ctrl><super>T',
      this._toggle_search_light.bind(this)
    );
    this.accel.listenFor('<super>Space', this._toggle_search_light.bind(this));
    this.accel.listenFor(
      '<ctrl><super>Space',
      this._toggle_search_light.bind(this)
    );

    // this._add_events();

    log('enabled');
  }

  disable() {
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
  }

  _acquire_ui() {
    if (this._entry) return;

    this._entry =
      Main.uiGroup.find_child_by_name(
        'overview'
      ).first_child.first_child.first_child;
    this._entryParent = this._entry.get_parent();

    this._search = Main.uiGroup.find_child_by_name('searchController');
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();

    this._entry.get_parent().remove_child(this._entry);
    this.container.add_child(this._entry);
    this._search.get_parent().remove_child(this._search);
    this.container.add_child(this._search);
    if (!this._search.__searchCancelled) {
      this._search.__searchCancelled = this._search._searchCancelled;
      this._search._searchCancelled = () => {};
    }
    this._textChangedEventId = this._search._text.connect(
      'text-changed',
      () => {
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
  }

  _queryDisplay() {
    this.monitor = Main.layoutManager.primaryMonitor;
    this.sw = this.monitor.width;
    this.sh = this.monitor.height;
  }

  show() {
    this._acquire_ui();
    this._queryDisplay();
    let width = 800;
    let height = 600;
    let x = this.sw / 2 - width / 2;
    let y = this.sh / 2 - height / 2;
    this._visible = true;
    this.container.set_size(width, height);
    this.container.set_position(x, y);
    this.container.show();

    this._add_events();
  }

  hide() {
    this._visible = false;
    this.container.hide();
    this._release_ui();
    this._remove_events();
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

    if (!this._inOverview) {
      this._overViewEvents = [];
      this._overViewEvents.push(
        Main.overview.connect('showing', this._onOverviewShowing.bind(this))
      );
      this._overViewEvents.push(
        Main.overview.connect('hidden', this._onOverviewHidden.bind(this))
      );
    }
  }

  _remove_events() {
    if (this._overViewEvents && !this._inOverview) {
      this._overViewEvents.forEach((id) => {
        Main.overview.disconnect(id);
      });
      this._overViewEvents = [];
    }

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
    this._release_ui();
  }

  _onOverviewHidden() {
    this._acquire_ui();
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
