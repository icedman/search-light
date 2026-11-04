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
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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

let GioUnix = null;
try {
  GioUnix = await import('gi://GioUnix');
} catch (e) {
  console.log('GioUnix not available on this GNOME version');
}
const DesktopAppInfo = GioUnix?.DesktopAppInfo || Gio.DesktopAppInfo;

var SearchLight = GObject.registerClass(
  {},
  class SearchLight extends St.Widget {
    _init() {
      super._init({
        style_class: 'searchLight'
      });
      this.name = 'searchLight';
      this.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
      this.layout_manager = new Clutter.BinLayout();

      // for blur-my-shell
      this._slider = {
        get_child: () => {
          return this;
        },
        get_parent: () => {
          return this;
        },
      };

      // pretend to be a dash
      // required by blur-my-shell to find the dash upon disabling
      this.fake_dash = new St.Widget({ name: 'dash' });
      this.add_child(this.fake_dash);
      this.fake_dash_background = new St.Widget({ style_class: 'dash-background' });
      this.fake_dash.add_child(this.fake_dash_background);
      this.fake_dash._background = this.fake_dash_background;
      this.fake_dash.visible = false;
    }
  }
);

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
        case 'panel-icon-color':
          this._updateCss();
          break;
        case 'use-animations':
          this._useAnimations = value;
          break;
        case 'animation-speed':
          this._animationSpeed = value;
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
        
      },
      this
    );

    this._unredirectDisabled = false;

    this.mainContainer = new SearchLight();
    this.mainContainer._delegate = this;
    this.container = new St.BoxLayout({
      name: 'searchLightBox',
      orientation: Clutter.Orientation.VERTICAL,
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

    this._useAnimations = this._settings.get_boolean('use-animations');
    this._animationSpeed = this._settings.get_double('animation-speed');

    // Overview signals are named 'showing'/'shown'/'hiding'/'hidden'
    // (see overview.js OVERVIEW_SHOWN_TRANSITIONS). The old 'overview-showing'
    // / 'overview-hidden' names never fired, so _inOverview was never set and
    // the "already in the overview" guard was dead code.
    Main.overview.connectObject(
      'showing',
      this._onOverviewShowing.bind(this),
      'hiding',
      this._onOverviewHidden.bind(this),
      this
    );

    Shell.AppSystem.get_default().connectObject(
      'app-state-changed',
      this._onAppStateChanged.bind(this),
      this
    );

    // Raw connect, not connectObject(this): _remove_events() calls
    // disconnectObject(this) on global.display for the connections that
    // show() owns, which used to tear this enable()-owned handler down as
    // well, killing window tracking after the first hide.
    this._windowCreatedId = global.display.connect(
      'window-created',
      (display, win) => {
        if (this._visible) {
          this.mainContainer.opacity = 0;
        }
      }
    );

    this._loTimer.runOnce(() => {
      // this.show();
    }, 500);

    Main.overview.searchLight = this;

    let appInfo = DesktopAppInfo.new_from_filename(
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
  }

  disable() {
    // Leave a consistent state behind: an interrupted hide no longer strands
    // _visible at true, but be explicit anyway.
    this._visible = false;

    if (this._windowCreatedId) {
      global.display.disconnect(this._windowCreatedId);
      this._windowCreatedId = null;
    }

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

    if (this._background) {
      if (this._background.get_parent()) {
        this._background.get_parent().remove_child(this._background);
      }
      this._background = null;
    }

    Main.layoutManager.removeChrome(this.mainContainer);
    this.mainContainer = null;
  }

  _createIndicator() {
    if (this._indicator) return;
    this._indicator = new St.Button({
      style_class: 'panel-status-indicators-box',
    });
    let icon = new St.Icon({
      style_class: 'panel-status-indicator-icon',
      icon_size: 16,
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

    let background = new St.Widget({
      name: 'searchLightBlurredBackground',
      layout_manager: new Clutter.BinLayout(),
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });

    this.mainContainer.insert_child_below(background, this.container);
    this._background = background;
    this._background.opacity = 0;
    this._background.visible = false;
  }

  show() {
    if (!this.mainContainer) return;
    if (this._visible) return;
    if (Main.overview.visible) return;

    if (this._animSeq) {
      this._hiTimer.cancel(this._animSeq);
      this._animSeq = null;
    }
    this._acquire_ui();

    if (this._bgActor) {
      let bgSource = Main.layoutManager._backgroundGroup.get_child_at_index(0);
      this._bgActor.set_content(bgSource.get_content());
    }

    this._updateCss();
    this._layout();

    this._setUnredirect(true);

    this.mainContainer.show();
    this.container.show();
    // Authoritative commit point. _layout() used to set this as a side
    // effect, which meant a hide() during the deferred animation below (or
    // an early _layout() return) could leave _visible disagreeing with what
    // is actually on screen - and the next accelerator press then did
    // nothing at all (issues #129, #146).
    this._visible = true;
    this._add_events();

    // fixes the background size relative to text - after adjusting font size
    this._animSeq = this._hiTimer.runOnce(() => {
      this._animSeq = null;
      // The overlay may have been dismissed while this was pending; do not
      // resurrect it.
      if (!this._visible) return;
      this._layout();
      // animate after adjust so width+height are correct
      if (this._useAnimations) {
        this.mainContainer.opacity = 0;
        this.mainContainer.scale_x = 0.9;
        this.mainContainer.scale_y = 0.9;
        this.mainContainer.translation_x = (this.width * 0.1) / 2;
        this.mainContainer.translation_y = (this.height * 0.1) / 2;
        this.mainContainer.ease({
          opacity: 255,
          scale_x: 1.0,
          scale_y: 1.0,
          translation_x: 0,
          translation_y: 0,
          duration: this._animationSpeed,
          mode: Clutter.AnimationMode.EASE_OUT,
        });
      } else {
        this.mainContainer.scale_x = 1.0;
        this.mainContainer.scale_y = 1.0;
        this.mainContainer.opacity = 255;
      }
    }, 100);
  }

  // Keeps the compositor unredirect state balanced. hide() is reachable from
  // many paths (focus change, Escape, fullscreen, init) even when the overlay
  // was never shown; the old code called enable_unredirect() unconditionally
  // and produced "Called enable_unredirect_for_display while unredirection is
  // enabled" whenever an unrelated window changed focus.
  _setUnredirect(disabled) {
    if (this._unredirectDisabled === disabled) return;
    this._unredirectDisabled = disabled;
    if (disabled) global.compositor.disable_unredirect();
    else global.compositor.enable_unredirect();
  }

  hide() {
    if (!this.mainContainer) return;
    if (this._isDraggingIcon()) {
      return;
    }

    // Reentrancy guard. hide() is reachable from the accelerator, from
    // 'notify::key-focus', from fullscreen changes and from app-state changes.
    // Detaching the search entry from the popup container changes key focus,
    // which emits 'notify::key-focus' *synchronously*, so _release_ui() used
    // to re-enter this method in the middle of itself: the nested call removed
    // the same child again while Clutter was already unmapping the actor.
    //
    //   clutter_actor_set_mapped: assertion '!CLUTTER_ACTOR_IN_MAP_UNMAP' failed
    //   Clutter:ERROR:clutter-actor.c:1982:clutter_actor_real_unrealize:
    //       assertion failed: (!clutter_actor_is_mapped (self))
    //   Bail out!
    //
    // That is a SIGABRT, which takes the whole shell and the session with it.
    if (this._hiding) return;
    this._hiding = true;

    try {
      // Cancel the pending show-animation first: it re-runs _layout() and would
      // otherwise run against a UI that is already released here.
      if (this._animSeq) {
        this._hiTimer.cancel(this._animSeq);
        this._animSeq = null;
      }

      // Commit the state up front. Clutter's ease() only invokes onComplete
      // when the transition actually finishes, so an interrupted hide left
      // _visible at true while the UI was already gone: the next Super+Space
      // took the "already open" branch and cleared key focus without ever
      // hiding anything. That is the "shortcut randomly stops working" bug.
      this._visible = false;
      this._setUnredirect(false);

      // Disconnect the stage handlers BEFORE touching the entry: while
      // 'notify::key-focus' is still connected, moving the entry re-enters
      // _onKeyFocusChanged() -> hide().
      this._remove_events();
      this._release_ui();

      if (this._useAnimations) {
        this.mainContainer.ease({
          opacity: 0,
          scale_x: 0.9,
          scale_y: 0.9,
          translation_x: (this.width * 0.1) / 2,
          translation_y: (this.height * 0.1) / 2,
          duration: this._animationSpeed,
          mode: Clutter.AnimationMode.EASE_OUT,
          // onStopped runs for interrupted transitions as well, so the actor
          // always ends up hidden. Guard on _visible: with autorepeat (holding
          // the accelerator, see #146) or a fast double press, show() can run
          // while this transition is still pending. Hiding here unconditionally
          // would then hide the popup that was just opened - and since
          // _acquire_ui() moved the overview's search entry into that container,
          // the result was a leftover box with no working entry that could only
          // be cleared by toggling the extension.
          onStopped: () => {
            if (this.mainContainer && !this._visible)
              this.mainContainer.hide();
          },
        });
      } else {
        this.mainContainer.opacity = 0;
        this.mainContainer.hide();
      }
      // this._hidePopups();
    } finally {
      this._hiding = false;
    }
  }

  _isDraggingIcon() {
    // cancel all drag
    let result = false;
    try {
      if (this._searchResults) {
        let grid =
          this._searchResults._content.first_child.first_child.child.child;
        if (grid.style_class == 'grid-search-results') {
          grid.get_children().forEach((c) => {
            // console.log(`${c._name} ${c._draggable._dragState}`);
            if (
              c._draggable &&
              c._draggable._dragState == 1 /* DragState.DRAGGING */
            ) {
              result = true;
            }
          });
        }
      }
    } catch (err) {
      console.log(err);
    }
    return result;
  }

  _layout() {
    this._queryDisplay();
    if (!this.monitor || !this._entry) return;

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
    // Deliberately NOT setting this._visible here any more: _layout() is a
    // layout pass, and setting state as a side effect of it is what allowed
    // it to disagree with the actual widget visibility.

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

    {
      if (!this._bms) {
        let bms_ext = Main.extensionManager.lookup('blur-my-shell@aunetx');
        if (bms_ext && bms_ext.stateObj) {
          let obj = bms_ext.stateObj;
          if (obj._dash_to_dock_blur) {
            obj._dash_to_dock_blur.try_blur(this.mainContainer);
          }
        }
      }

      // blur my shell
      let bms = this.mainContainer.get_children().find((child) => {
        let name = child.get_name();
        return name === 'bms-dash-backgroundgroup';
      });

      this._bms = bms;
      this._updateBlurSize();
    }
  }

  _updateBlurSize() {
    let bms = this._bms;
    if (bms) {
      if (!this.blur_background) {
        bms.visible = false;
        return;
      }

      let meta_background = bms.first_child.first_child;
      if (!meta_background) {
        // this should exists
        return;
      }

      bms.visible = true;
      let x = this.monitor.x + this.sw / 2 - this.width / 2;
      let y = this.monitor.y + this.sh / 2 - this.height / 2;
      bms.x = 0;
      bms.y = 0;
      bms.first_child.x = -x;
      bms.first_child.y = -y;
      bms.first_child.set_clip(
        x,
        y,
        this.mainContainer.width,
        this.mainContainer.height
      );

      let opacity = (this.background_color[3] ?? 0.5) * 54 + 200;
      meta_background.opacity = opacity;

      this._blur_effects = bms.first_child.get_effects();
      if (this._blur_effects) {
        this._blur_effects.forEach((e) => {
          if (e.constructor.name == 'CornerEffect') {
            e.radius = this.computed_border_radius ?? 0;
          }
        });
      }
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
      this._grab(this.accel, shortcut, 3);
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
      this._grab(this.accel2, shortcut, 3);
    }
  }

  // Grabbing can fail transiently: another client may be holding the combo
  // (a browser starting up, a game with a raw grab, or the shell itself during
  // a session-mode reload around screen lock). The old code logged one line
  // and gave up, leaving an extension that looked enabled but had no working
  // shortcut until it was toggled by hand. Retry a few times with backoff.
  _grab(accel, shortcut, retries) {
    if (!accel) return;

    const action = accel.listenFor(
      shortcut,
      this._toggle_search_light.bind(this)
    );
    if (action !== null) return;

    if (retries <= 0 || !this._loTimer) {
      console.log(
        `search-light: giving up on ${shortcut} after repeated failed grabs`
      );
      return;
    }

    this._loTimer.runOnce(() => this._grab(accel, shortcut, retries - 1), 500);
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
    if (!this._entry) return;
    
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
        this._updateBlurSize();
        this._search.show();
      }
    );

    this._search._text.get_parent().grab_key_focus();
  }

  _release_ui() {
    // Take the references out before detaching anything. Moving the entry
    // emits 'notify::key-focus' synchronously, and even with the guard in
    // hide() a re-entrant caller must never be able to detach the same actor
    // twice - that is what tripped Clutter's map/unmap assertions.
    const entry = this._entry;
    this._entry = null;
    if (entry) {
      if (entry.get_parent()) {
        entry.get_parent().remove_child(entry);
      }
      this._entryParent.add_child(entry);
    }

    const search = this._search;
    this._search = null;
    if (search) {
      this._removeProviders();
      search.hide();
      if (search.get_parent()) {
        search.get_parent().remove_child(search);
      }
      this._searchParent.add_child(search);
      if (this._textChangedEventId) {
        search._text.disconnect(this._textChangedEventId);
        this._textChangedEventId = null;
      }
      if (search.__searchCancelled) {
        search._searchCancelled = search.__searchCancelled;
        search.__searchCancelled = null;
      }

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

    this._background.visible = true;
    this._background.opacity = 200;

    let styles = [];
    {
      let ss = [];

      let rgba = this._style.rgba(this.background_color);
      ss.push(`background: rgba(${rgba});`);

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

    {
      if (this.border_radius !== null) {
        let rads = [0, 16, 18, 20, 22, 24, 28, 32];
        let r = rads[Math.floor(this.border_radius)];
        this.computed_border_radius = r;
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

    // icon color
    {
      let ss = [];
      {
        let clr = this._style.rgba(this.panel_icon_color);
        if (this.panel_icon_color[3] > 0) {
          ss.push(`\n  color: rgba(${clr}) !important;`);
        }
      }
      styles.push(`.panel-status-indicator-icon {${ss.join(' ')}}`);
    }

    // console.log(styles);
    this._style.build('custom-search-light', styles);
  }

  _toggle_search_light() {
    if (!this.mainContainer) return;

    // Autorepeat (holding the accelerator, #146) and fast double presses fire
    // this repeatedly. Serialise them: re-entering the toggle while a show() or
    // hide() is still running is what used to leave the state machine and the
    // actor tree disagreeing.
    if (this._toggling) return;
    this._toggling = true;

    try {
      // While the stock overview is open, show() bails out; the accelerator then
      // did nothing at all. Dismiss the overview instead so the key always has
      // an effect.
      if (Main.overview.visible) {
        Main.overview.hide();
        return;
      }

      if (!this._visible) {
        this.show();
        if (this._entry) {
          global.stage.set_key_focus(this._entry);
        }
      } else {
        // Hide directly. The old code only cleared key focus and relied on the
        // 'notify::key-focus' handler to notice and hide, which silently failed
        // whenever something else held the focus.
        this.hide();
      }
    } finally {
      this._toggling = false;
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
    // Only the stage/display connections that show() owns may be dropped
    // here. This used to also disconnect Main.overview and the app system,
    // which enable() had connected on `this` - so the first hide() killed the
    // overview tracking and app-state handling for the rest of the session.
    global.display.disconnectObject(this);
    global.stage.disconnectObject(this);
  }

  _onOverviewShowing() {
    this._inOverview = true;
    // Do not let the popup and the overview fight over the same chrome.
    if (this._visible) this.hide();
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
      focus &&
      (this._entry.contains(focus) || this._searchResults.contains(focus));

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
    if (focus && focus.activate) {
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
    if (!focus || !this._entry.contains(focus)) {
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
