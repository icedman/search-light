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
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Graphene from 'gi://Graphene';
import { trySpawnCommandLine } from 'resource:///org/gnome/shell/misc/util.js';

import { Timer } from './timer.js';
import { Style } from './style.js';

import { TintEffect } from './effects/tint_effect.js';
import { MonochromeEffect } from './effects/monochrome_effect.js';
import { BlurEffect } from './effects/blur_effect.js';

import { schemaId, SettingsKeys } from './preferences/keys.js';
import { KeyboardShortcuts } from './keybinding.js';

import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

var SearchLight = GObject.registerClass(
  {},
  class SearchLight extends St.Widget {
    _init() {
      super._init();
      this.name = 'searchLight';
      this.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
      this.layout_manager = new Clutter.BinLayout();
    }
  }
);

const BLURRED_BG_PATH = '/tmp/searchlight-bg-blurred.jpg';

export default class SearchLightExt extends Extension {
  enable() {
    Main.overview.graphene = Graphene;

    this._style = new Style();

    this._hiTimer = new Timer('hi-res timer');
    this._hiTimer.initialize(15);

    // for deferred or debounced runs
    this._loTimer = new Timer('lo-res timer');
    this._loTimer.initialize(750);

    this._settings = this.getSettings(schemaId);
    this._settingsKeys = SettingsKeys();

    this._settingsKeys.connectSettings(this._settings, (name, value) => {
      let n = name.replace(/-/g, '_');
      this[n] = value;
      switch (name) {
        case 'show-panel-icon':
          if (this._indicator) {
            this._indicator.visible = value;
          }
          break;
        case 'background-color':
        case 'blur-background':
          this._updateBlurredBackground();
          this._updateCss();
          break;
        case 'border-radius':
          break;
        case 'shortcut-search':
          this._updateShortcut();
          break;
        case 'secondary-shortcut-search':
          this._updateShortcut2();
          break;
        case 'window-effect': {
          this._updateWindowEffect();
          break;
        }
        case 'window-effect-color': {
          if (this.windowEffect) {
            this.windowEffect.color = this.window_effect_color;
          }
          break;
        }
      }
    });
    Object.keys(this._settingsKeys._keys).forEach((k) => {
      let key = this._settingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
      if (key.options) {
        this[`${name}_options`] = key.options;
      }
      // console.log(`${name} ${key.value}`);
    });

    this._desktopSettings = new Gio.Settings({
      schema_id: 'org.gnome.desktop.background',
    });
    this._desktopSettings.connectObject(
      'changed::picture-uri',
      () => {
        this._updateBlurredBackground();
      },
      this
    );

    this.mainContainer = new SearchLight();
    this.mainContainer._delegate = this;
    this.container = new St.BoxLayout({
      name: 'searchLightBox',
      vertical: true,
      reactive: true,
      track_hover: true,
      can_focus: true,
    });
    this.hide();
    this.container._delegate = this;

    Main.layoutManager.addChrome(this.mainContainer, {
      affectsStruts: false,
      affectsInputRegion: true,
      trackFullscreen: false,
    });

    this.mainContainer.add_child(this.container);

    this._setupBackground();

    this.accel = new KeyboardShortcuts();
    this.accel.enable();
    this.accel2 = new KeyboardShortcuts();
    this.accel2.enable();

    this._updateShortcut();
    this._updateShortcut2();
    this._updateCss();

    Main.overview.connectObject(
      'overview-showing',
      this._onOverviewShowing.bind(this),
      'overview-hidden',
      this._onOverviewHidden.bind(this),
      this
    );

    Main.sessionMode.connectObject('updated', () => this.hide(), this);

    Shell.AppSystem.get_default().connectObject(
      'app-state-changed',
      this._onAppStateChanged.bind(this),
      this
    );

    global.display.connectObject(
      'window-created',
      (display, win) => {
        if (this._visible) {
          this.mainContainer.opacity = 0;
        }
      },
      this
    );

    this._loTimer.runOnce(() => {
      //this.show();
      // console.log('SearchLightExt: ???');
    }, 500);

    Main.overview.searchLight = this;

    let appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${this.path}/apps/org.gnome.Calculator.desktop`
    );

    let _providers = [];

    // deferred startup for providers
    let idx = 0;
    _providers.forEach((p) => {
      this._loTimer.runOnce(() => {
        p.initialize();
      }, idx * 5000);
    });

    this._loTimer.runOnce(() => {
      this._createIndicator();
    }, 1500);
    this._updateProviders();
    this._updateWindowEffect();
    this._updateBlurredBackground();
  }

  disable() {
    this._hiTimer?.shutdown();
    this._loTimer?.shutdown();
    this._hiTimer = null;
    this._loTimer = null;

    if (this._indicator) {
      this._indicator.disconnectObject(this);
      if (this._indicator.get_parent()) {
        this._indicator.get_parent().remove_child(this._indicator);
      }
      this._indicator = null;
    }

    this._style.unloadAll();
    this._style = null;

    this._settingsKeys.disconnectSettings();
    this._settings = null;

    this._desktopSettings.disconnectObject();
    this._desktopSettings = null;

    if (this.accel) {
      this.accel.disable();
      delete this.accel;
      this.accel = null;
    }
    if (this.accel2) {
      this.accel2.disable();
      delete this.accel2;
      this.accel2 = null;
    }

    this._removeProviders();
    this._providers = null;

    Main.layoutManager.removeChrome(this.mainContainer);
    this.mainContainer = null;
  }

  _createIndicator() {
    if (this._indicator) return;
    this._indicator = new St.Button({
      style_class: 'panel-status-indicators-box',
    });
    let icon = new St.Icon({
      gicon: new Gio.ThemedIcon({ name: 'search-symbolic' }),
    });
    icon.style = 'margin-top: 6px !important; margin-bottom: 6px !important;';
    this._indicator.set_child(icon);
    this._indicator.connectObject(
      'button-press-event',
      this._toggle_search_light.bind(this),
      this
    );
    try {
      Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
      this._indicator.visible = this.show_panel_icon;
    } catch (err) {
      console.log(err);
    }
  }

  _createEffect(idx) {
    let effect = null;
    switch (idx) {
      case 1: {
        effect = new TintEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
      case 2: {
        effect = new MonochromeEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
      case 3: {
        effect = new BlurEffect({
          name: 'color',
          color: this.window_effect_color,
        });
        effect.preload(this.path);
        break;
      }
    }
    return effect;
  }

  _updateBlurredBackground() {
    this.desktop_background = this._desktopSettings.get_string('picture-uri');
    this.desktop_background_blurred = BLURRED_BG_PATH;
    if (this.blur_background) {
      //   let color = this.background_color || [0, 0, 0, 0.5];
      //   let bg = this._desktopSettings.get_string('picture-uri');
      //   let a = Math.floor(100 - color[3] * 100);
      //   let rgb = this._style.hex(color);
      // 	 let cmd = `convert -scale 10% -blur 0x2.5 -resize 200% -fill "${rgb}" -tint ${a} "${bg}" ${BLURRED_BG_PATH}`;
      let cmd = `convert -scale 10% -blur 0x2.5 -resize 200% "${this.desktop_background}" ${BLURRED_BG_PATH}`;
      console.log(cmd);
      trySpawnCommandLine(cmd);
    }
  }

  _updateWindowEffect() {
    // this.window_effect = 2;
    // this.window_effect_color = [1, 0, 0, 0.5];
    this.container.remove_effect_by_name('window-effect');
    let effect = this._createEffect(this.window_effect);
    if (effect) {
      this.container.add_effect_with_name('window-effect', effect);
    }
    this.windowEffect = effect;
  }

  _updatePanelIcon(disable) {}

  _updateProviders() {
    this._removeProviders();
    this._providers = [];

    let _search = Main.overview.searchController;
    if (!_search) return;

    // add providers here

    if (_search.addProvider) {
      this._providers.forEach((p) => {
        _search.addProvider(p);
      });
    }
  }

  _removeProviders() {
    if (!this._providers) {
      return;
    }

    let _search = Main.overview.searchController;
    if (!_search) return;

    if (_search.removeProvider) {
      this._providers.forEach((p) => {
        _search.removeProvider(p);
      });
    }

    this._providers = null;
  }

  _setupBackground() {
    if (this._background && this._background.get_parent()) {
      this._background.get_parent().remove_child(this._background);
    }

    // blurred background image
    // this._bgActor = new Meta.BackgroundActor();
    // let bgSource = Main.layoutManager._backgroundGroup.get_child_at_index(0);
    // this._bgActor.set_content(bgSource.get_content());
    // this._blurEffect = new Shell.BlurEffect({
    //   name: 'blur',
    //   brightness: this.blur_brightness,
    //   sigma: this.blur_sigma,
    //   mode: Shell.BlurMode.ACTOR,
    // });

    if (!this._blurEffect) {
      this._blurEffect = this._createEffect(1);
    }

    let background = new St.Widget({
      name: 'searchLightBlurredBackground',
      layout_manager: new Clutter.BinLayout(),
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });

    // let image = new St.Widget({
    //   name: 'searchLightBlurredBackgroundImage',
    //   x: 0,
    //   y: 0,
    //   width: 20,
    //   height: 20,
    //   effect: this._blurEffect,
    // });

    // image.add_child(this._bgActor);
    // background.add_child(image);
    // this._bgActor.clip_to_allocation = true;
    // this._bgActor.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;

    this.mainContainer.insert_child_below(background, this.container);
    this._background = background;
    this._background.opacity = 0;
    this._background.visible = false;
  }

  show() {
    if (Main.overview.visible) return;

    this._acquire_ui();

    if (this._bgActor) {
      let bgSource = Main.layoutManager._backgroundGroup.get_child_at_index(0);
      this._bgActor.set_content(bgSource.get_content());
    }

    this.mainContainer.opacity = 0;
    this._updateCss();
    this._layout();
    this.mainContainer.show();
    this.container.show();

    // fixes the background size relative to text - after adjusting font size
    this._hiTimer.runOnce(() => {
      this.mainContainer.opacity = 255;
      this._layout();
    }, 100);

    this._add_events();

    Meta.disable_unredirect_for_display(global.display);
  }

  hide() {
    this._visible = false;
    this._release_ui();
    this._remove_events();
    this.mainContainer.hide();
    // this._hidePopups();

    Meta.enable_unredirect_for_display(global.display);
  }

  _layout() {
    this._queryDisplay();
    if (!this.monitor) return;

    // container size
    this.width =
      600 + ((this.sw * this.scaleFactor) / 2) * (this.scale_width || 0);
    this.height =
      400 + ((this.sh * this.scaleFactor) / 2) * (this.scale_height || 0);

    // initial height
    let font_size = 14;
    if (this.font_size) {
      font_size = this.font_size_options[this.font_size];
    }
    if (this.entry_font_size) {
      font_size = this.entry_font_size_options[this.entry_font_size];
    }

    // let padding = {
    //   14: 14 * 2.5,
    //   16: 16 * 2.4,
    //   18: 18 * 2.2,
    //   20: 20 * 2.0,
    //   22: 22 * 1.8,
    //   24: 24 * 1.6,
    // };
    // this.initial_height = padding[font_size] * this.scaleFactor;
    // this.initial_height += font_size * 2 * this.scaleFactor;
    // console.log(`${this.initial_height} ${this._entry.height}`);

    this.initial_height = this._entry.height + 4 * this.scaleFactor;

    // position
    let x = this.monitor.x + this.sw / 2 - this.width / 2;
    let y = this.monitor.y + this.sh / 2 - this.height / 2;
    this._visible = true;

    this.container.set_size(this.width, this.initial_height);
    this.mainContainer.set_size(this.width, this.initial_height);
    this.mainContainer.set_position(x, y);

    // background
    if (this._background) {
      if (this._bgActor) {
        this._bgActor.set_position(this.monitor.x - x, this.monitor.y - y);
        this._bgActor.set_size(this.monitor.width, this.monitor.height);
        this._bgActor
          .get_parent()
          .set_size(this.monitor.width, this.monitor.height);
      }
      let padding = 0; //this.border_thickness || 0;
      this._background.set_position(padding, padding);
      this._background.set_size(
        this.monitor.width - padding * 2,
        this.monitor.height - padding * 2
      );
    }
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

  _updateShortcut2(disable) {
    this.accel2.unlisten();

    let shortcut = '';
    try {
      shortcut = (this.secondary_shortcut_search || []).join('');
    } catch (err) {
      //
    }
    if (shortcut == '') {
      shortcut = '<Control><Super>Space';
    }

    if (!disable) {
      this.accel2.listenFor(shortcut, this._toggle_search_light.bind(this));
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
    if (!Main.overview._hide) {
      Main.overview._hide = Main.overview.hide;
    }
    Main.overview.hide = () => {
      this.mainContainer.opacity = 0;
      Main.overview._hide();
    };

    this._queryDisplay();

    this.scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

    this._entry = Main.overview.searchEntry;
    this._entryParent = this._entry.get_parent();
    this._entry.add_style_class_name('slc');

    this._search = Main.overview.searchController;

    this._search.hide();
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();

    if (!this._searchResults._activateDefault) {
      this._searchResults._activateDefault =
        this._searchResults.activateDefault;
    }
    this._searchResults.activateDefault = () => {
      // hide window immediately when activated
      this.mainContainer.opacity = 0;
      this._searchResults._activateDefault();
    };

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
    this._search._text.get_parent().grab_key_focus();
    this._textChangedEventId = this._search._text.connect(
      'text-changed',
      () => {
        this.container.set_size(this.width, this.height);
        this.mainContainer.set_size(this.width, this.height);
        if (this._corners) {
          this._corners[2].y = this.height - this._corners[1].height;
          this._corners[3].y = this.height - this._corners[1].height;
          this._edges[3].y = this.height - 2;
        }
        this._search.show();
      }
    );

    this._search._text.get_parent().grab_key_focus();
  }

  _release_ui() {
    if (this._entry) {
      this._entry.get_parent().remove_child(this._entry);
      this._entryParent.add_child(this._entry);
      this._entry = null;
    }

    if (this._search) {
      this._removeProviders();
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

      if (this._searchResults._activateDefault) {
        this._searchResults.activateDefault =
          this._searchResults._activateDefault;
        this._searchResults._activateDefault = null;
      }
    }

    if (Main.overview._toggle) {
      Main.overview.toggle = Main.overview._toggle;
      Main.overview._toggle = null;
    }
    if (Main.overview._hide) {
      Main.overview.hide = Main.overview._hide;
      Main.overview._hide = null;
    }
  }

  _updateCss(disable) {
    let bg = this.background_color || [0, 0, 0, 0.5];
    if (this.text_color && this.text_color[3] > 0) {
      this.container.remove_style_class_name('light');
    } else {
      if (0.3 * bg[0] + 0.59 * bg[1] + 0.11 * bg[2] < 0.5) {
        this.container.remove_style_class_name('light');
      } else {
        this.container.add_style_class_name('light');
      }
    }

    this._background.remove_effect_by_name('blur');
    if (this._blurEffect && this.blur_background) {
      this._background.add_effect_with_name('blur', this._blurEffect);
      this._blurEffect.color = bg;
    }

    this._background.visible = true;
    this._background.opacity = 200;

    let styles = [];
    {
      let ss = [];

      if (!this.blur_background) {
        let clr = this._style.rgba(this.background_color);
        ss.push(`\n  background: rgba(${clr});`);
      }

      if (
        this.border_thickness
        // && !this.blur_background
      ) {
        let clr = this._style.rgba(this.border_color);
        ss.push(`\n  border: ${this.border_thickness}px solid rgba(${clr});`);
      }

      styles.push(`#searchLight {${ss.join(' ')}}`);
      styles.push(`#searchLightBlurredBackground {${ss.join(' ')}}`);
    }

    // ss.push(`\n background-image: url("${bg}");`);
    if (
      this.blur_background &&
      this.desktop_background_blurred &&
      this.monitor
    ) {
      let sw = this.monitor.width;
      let sh = this.monitor.height;
      let ss = [];
      // ss.push(`\n background-image: url("${BLURRED_BG_PATH}");`);
      ss.push(
        `\n background-image: url("${this.desktop_background_blurred}");`
      );
      ss.push(`\n background-size: ${sw}px ${sh}px;`);
      ss.push(`\n background-position: top center;`);
      // ss.push(`\n border: 2px solid red;`);
      this._background.style = ss.join(' ');

      // styles.push(`#searchLightBlurredBackground {${ss.join(' ')}}`);
      // styles.push(`#searchLight {${ss.join(' ')}}`);
    } else {
      this._background.style = '';
    }

    {
      if (this.border_radius !== null) {
        let rads = [0, 16, 18, 20, 22, 24, 28, 32];
        let r = rads[Math.floor(this.border_radius)];
        if (r) {
          let st = `StBoxLayout.search-section-content { border-radius: ${r}px !important; }`;
          st = '#searchLightBlurredBackgroundImage,\n' + st; // has no effect
          st = '#searchLightBlurredBackground,\n' + st; // has no effect
          st = '#searchLightBox,\n' + st;
          st = '#searchLight,\n' + st;
          styles.push(st);
        }
      }
    }

    if (this.font_size !== null) {
      let f = this.font_size_options[this.font_size];
      if (f) {
        styles.push(`#searchLightBox * { font-size: ${f}pt !important; }`);
      }
      f = this.entry_font_size_options[this.entry_font_size];
      if (f) {
        styles.push(
          `#searchLightBox > StEntry, #searchLightBox > StEntry:focus { font-size: ${f}pt !important; }`
        );
      }
    }

    let clr = this._style.rgba(this.text_color);
    if ((this.text_color || [1, 1, 1, 1])[3] > 0) {
      styles.push(`#searchLightBox * { color: rgba(${clr}) !important }`);
    } else {
      styles.push('/* empty */');
    }

    // console.log(styles);
    this._style.build('custom-search-light', styles);
  }

  _toggle_search_light() {
    if (this._inOverview) return;
    if (!this._visible) {
      this.show();
      if (this._entry) {
        global.stage.set_key_focus(this._entry);
      }
    } else {
      global.stage.set_key_focus(null);
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
    Main.sessionMode.disconnectObject(this);
    Shell.AppSystem.get_default().disconnectObject(this);
  }

  _onOverviewShowing() {
    this._inOverview = true;
  }

  _onOverviewHidden() {
    this._inOverview = false;
  }

  _onAppStateChanged(st) {
    this._lastAppState = st;
    if (this._visible) {
      this.mainContainer.opacity = 0;
    }
  }

  _hidePopups() {
    let popup = this._lastPopup;
    this._lastPopup = null;
    try {
      if (!popup.close && popup._getTopMenu()) {
        popup = popup._getTopMenu();
      }

      // elaborate way of hiding the popup
      popup.opacity = 0;
      this._startupSeq = this._hiTimer.runSequence([
        {
          func: () => {
            popup.opacity = 0;
          },
          delay: 0,
        },
        {
          func: () => {
            popup._delegate.close(false);
          },
          delay: 250,
        },
      ]);
    } catch (err) {
      console.log(err);
    }
  }

  _onFocusWindow(w, e) {}

  _onKeyFocusChanged(previous) {
    if (!this._entry) return;
    let focus = global.stage.get_key_focus();
    let appearFocused =
      this._entry.contains(focus) || this._searchResults.contains(focus);

    if (!appearFocused) {
      // popups are not handled well.. hide immediately
      if (
        focus &&
        focus.style_class &&
        focus.style_class.includes('popup-menu')
      ) {
        this._lastPopup = focus;
        this._hidePopups();
      }

      this.hide();
    }

    // hide window immediately when activated
    if (focus.activate) {
      if (!focus._activate) {
        focus._activate = focus.activate;
        focus.activate = () => {
          this.mainContainer.opacity = 0;
          focus._activate();
        };
      }
    }
  }

  _onKeyPressed(obj, evt) {
    if (!this._entry) return;
    let focus = global.stage.get_key_focus();
    if (!this._entry.contains(focus)) {
      if (evt.get_key_symbol() === Clutter.KEY_Escape) {
        this.hide();
        return Clutter.EVENT_STOP;
      }
      this._search._text.get_parent().grab_key_focus();
    }
    return Clutter.EVENT_STOP;
  }

  _onFullScreen() {
    this.hide();
  }
}
