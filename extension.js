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

var SearchLight = GObject.registerClass(
  {},
  class SearchLight extends St.Widget {
    _init() {
      super._init();
      this.name = 'searchLight';
      this.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
      this.layout_manager = new Clutter.BinLayout();
    }
  },
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
          this._updateBlurredBackground();
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
    // GNOME 42+ has separate light/dark wallpapers; Fedora defaults to dark.
    // Watch both so the blurred snapshot stays in sync on theme switches
    // (GNOME 48/49/50). connectObject binds to `this` and is torn down in
    // disable() via _disconnectPersistentSignals().
    for (const key of ['picture-uri', 'picture-uri-dark']) {
      try {
        this._desktopSettings.connectObject(
          `changed::${key}`,
          () => {
            this._updateBlurredBackground();
          },
          this,
        );
      } catch (err) {
        // Older schemas may lack picture-uri-dark; light key is sufficient.
        console.log(`search-light: cannot watch desktop ${key}: ${err}`);
      }
    }

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

    // NB: `affectsInputRegion` was removed from addChrome in GNOME 50
    // (mutter rejects unknown chrome params). Keep the param set minimal
    // so the same code path works on 48/49/50.
    try {
      Main.layoutManager.addChrome(this.mainContainer, {
        affectsStruts: false,
        trackFullscreen: false,
      });
    } catch (err) {
      console.log(`search-light: addChrome failed: ${err}`);
      // Fall back to a bare addChrome so the popup still shows.
      try {
        Main.layoutManager.addChrome(this.mainContainer);
      } catch (innerErr) {
        console.log(`search-light: addChrome fallback failed: ${innerErr}`);
      }
    }

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

    Main.overview.connectObject(
      'overview-showing',
      this._onOverviewShowing.bind(this),
      'overview-hidden',
      this._onOverviewHidden.bind(this),
      this,
    );

    Shell.AppSystem.get_default().connectObject(
      'app-state-changed',
      this._onAppStateChanged.bind(this),
      this,
    );

    global.display.connectObject(
      'window-created',
      (display, win) => {
        if (this._visible) {
          this.mainContainer.opacity = 0;
        }
      },
      this,
    );

    this._loTimer.runOnce(() => {
      // this.show();
    }, 500);

    Main.overview.searchLight = this;

    let appInfo = Gio.DesktopAppInfo.new_from_filename(
      `${this.path}/apps/org.gnome.Calculator.desktop`,
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
    // Idempotent teardown: disable() may run after a partial enable() or
    // twice during session shutdown. Every step is guarded so one failure
    // cannot leak the remaining actors, timers, or signal handlers.
    try {
      if (this._animSeq && this._hiTimer) this._hiTimer.cancel(this._animSeq);
    } catch (err) {
      console.log(`search-light: cannot cancel animation: ${err}`);
    }
    this._animSeq = null;

    this._removeTransientEvents();
    this._disconnectPersistentSignals();

    // Restore any monkey-patched Overview methods before dropping actors.
    this._release_ui();

    try {
      this._hiTimer?.shutdown();
    } catch (err) {
      console.log(`search-light: hi-timer shutdown: ${err}`);
    }
    try {
      this._loTimer?.shutdown();
    } catch (err) {
      console.log(`search-light: lo-timer shutdown: ${err}`);
    }
    this._hiTimer = null;
    this._loTimer = null;

    if (this._indicator) {
      try {
        this._indicator.disconnectObject(this);
      } catch {
        // Already disconnected; safe to ignore.
      }
      try {
        if (this._indicator.get_parent()) {
          this._indicator.get_parent().remove_child(this._indicator);
        }
      } catch (err) {
        console.log(`search-light: cannot remove indicator: ${err}`);
      }
      this._indicator = null;
    }

    try {
      this._style?.unloadAll();
    } catch (err) {
      console.log(`search-light: style unload: ${err}`);
    }
    this._style = null;

    try {
      this._settingsKeys?.disconnectSettings();
    } catch (err) {
      console.log(`search-light: settings disconnect: ${err}`);
    }
    this._settings = null;
    this._settingsKeys = null;

    if (this._desktopSettings) {
      try {
        this._desktopSettings.disconnectObject(this);
      } catch {
        // Never connected or already torn down.
      }
      this._desktopSettings = null;
    }

    for (const key of ['accel', 'accel2']) {
      if (this[key]) {
        try {
          this[key].disable();
        } catch (err) {
          console.log(`search-light: ${key} disable: ${err}`);
        }
        this[key] = null;
      }
    }

    try {
      this._removeProviders();
    } catch (err) {
      console.log(`search-light: remove providers: ${err}`);
    }
    this._providers = null;

    if (this._background) {
      try {
        if (this._background.get_parent()) {
          this._background.get_parent().remove_child(this._background);
        }
      } catch (err) {
        console.log(`search-light: cannot remove background: ${err}`);
      }
      this._background = null;
    }

    if (this.mainContainer) {
      try {
        Main.layoutManager.removeChrome(this.mainContainer);
      } catch (err) {
        console.log(`search-light: removeChrome: ${err}`);
      }
      this.mainContainer = null;
    }
    this.container = null;
    this._visible = false;

    if (Main.overview?.searchLight === this) {
      Main.overview.searchLight = null;
    }
  }

  /**
   * Disconnect signals wired once in enable() (overview visibility,
   * app-state, window-created). These must survive show()/hide() cycles —
   * only disable() tears them down. Previously _remove_events() killed
   * them on the first hide(), leaving the popup deaf afterwards.
   */
  _disconnectPersistentSignals() {
    for (const target of [
      Main.overview,
      Shell.AppSystem.get_default(),
      global.display,
    ]) {
      try {
        target?.disconnectObject?.(this);
      } catch {
        // Not connected; ignore so one bad target can't block the rest.
      }
    }
  }

  _createIndicator() {
    if (this._indicator) return;
    this._indicator = new St.Button({
      style_class: 'panel-status-indicators-box',
    });
    let icon = new St.Icon({
      style_class: 'panel-status-indicator-icon',
      gicon: new Gio.ThemedIcon({ name: 'search-symbolic' }),
    });
    icon.style = 'margin-top: 6px !important; margin-bottom: 6px !important;';
    this._indicator.set_child(icon);
    this._indicator.connectObject(
      'button-press-event',
      this._toggle_search_light.bind(this),
      this,
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

  /**
   * Resolve the active desktop wallpaper to a local filesystem path.
   * Prefers the dark-mode URI when set (Fedora/GNOME 42+ default), falls
   * back to the light URI. Strips the `file://` scheme and URI-decoding so
   * the result can be handed to ImageMagick, which does not accept URIs.
   * Returns '' when no usable wallpaper is configured.
   */
  _resolveDesktopBackground() {
    if (!this._desktopSettings) return '';

    let uri = '';
    try {
      const dark = this._desktopSettings.get_string('picture-uri-dark');
      if (dark && dark !== "''" && dark !== '') uri = dark;
    } catch {
      // Schema without picture-uri-dark (pre-42); fall through to light key.
    }
    if (!uri) {
      try {
        uri = this._desktopSettings.get_string('picture-uri') || '';
      } catch (err) {
        console.log(`search-light: cannot read picture-uri: ${err}`);
        return '';
      }
    }
    if (!uri || uri === "''") return '';

    // Strip quotes gsettings may include, then file:// scheme.
    uri = uri.replace(/^'|'$/g, '');
    if (uri.startsWith('file://')) {
      try {
        return GLib.filename_from_uri(uri)[0];
      } catch {
        uri = uri.replace(/^file:\/\//, '');
      }
    }
    try {
      return decodeURIComponent(uri);
    } catch {
      return uri;
    }
  }

  /**
   * Pick the ImageMagick entry point. v7 (`magick`) is preferred;
   * Fedora 44 ships both but `convert` prints a deprecation warning and
   * may vanish in future releases.
   */
  _blurCommandFor(src, dst) {
    const magick = GLib.find_program_in_path('magick');
    const convert = GLib.find_program_in_path('convert');
    const bin = magick || convert;
    if (!bin) return null;
    // Quote paths: wallpapers commonly contain spaces (e.g. "Summer Day").
    return `${bin} "${src}" -scale 10% -blur 0x2.5 -resize 200% "${dst}"`;
  }

  _updateBlurredBackground() {
    this.desktop_background = this._resolveDesktopBackground();

    const uuid = GLib.get_user_name();
    this.desktop_background_blurred = `/tmp/searchlight-${uuid}-bg-blurred.jpg`;

    if (!this.blur_background) return;
    if (!this.desktop_background) {
      console.log('search-light: no desktop background to blur; skipping');
      return;
    }
    if (!Gio.File.new_for_path(this.desktop_background).query_exists(null)) {
      console.log(
        `search-light: background not found: ${this.desktop_background}`,
      );
      return;
    }

    const cmd = this._blurCommandFor(
      this.desktop_background,
      this.desktop_background_blurred,
    );
    if (!cmd) {
      console.log('search-light: imagemagick not found; cannot blur');
      return;
    }
    console.log(cmd);
    trySpawnCommandLine(cmd);
  }

  _updateWindowEffect() {
    if (!this.container) return;
    try {
      this.container.remove_effect_by_name('window-effect');
    } catch (err) {
      console.log(`search-light: cannot remove window effect: ${err}`);
    }
    let effect = null;
    try {
      effect = this._createEffect(this.window_effect);
    } catch (err) {
      console.log(`search-light: cannot create window effect: ${err}`);
    }
    if (effect) {
      try {
        this.container.add_effect_with_name('window-effect', effect);
      } catch (err) {
        console.log(`search-light: cannot add window effect: ${err}`);
        effect = null;
      }
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

  /**
   * Toggle fullscreen unredirect around the popup. On GNOME 50/Wayland this
   * is a no-op but the API still exists; guard it so a future Mutter
   * removal degrades to a warning instead of breaking show()/hide().
   */
  _setUnredirect(disable) {
    try {
      const compositor = global.compositor;
      if (!compositor) return;
      if (disable) {
        compositor.disable_unredirect?.();
      } else {
        compositor.enable_unredirect?.();
      }
    } catch (err) {
      console.log(`search-light: unredirect toggle failed: ${err}`);
    }
  }

  show() {
    if (Main.overview?.visible) return;
    if (!this.mainContainer || !this.container) return;

    if (this._animSeq && this._hiTimer) {
      try {
        this._hiTimer.cancel(this._animSeq);
      } catch (err) {
        console.log(`search-light: cannot cancel animation: ${err}`);
      }
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
    this._addTransientEvents();

    // fixes the background size relative to text - after adjusting font size
    this._animSeq = this._hiTimer.runOnce(() => {
      this._animSeq = null;
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

  hide() {
    if (!this.mainContainer) return;
    if (this._isDraggingIcon()) {
      return;
    }

    this._release_ui();
    this._removeTransientEvents();

    if (this._useAnimations) {
      try {
        this.mainContainer.ease({
          opacity: 0,
          scale_x: 0.9,
          scale_y: 0.9,
          translation_x: (this.width * 0.1) / 2,
          translation_y: (this.height * 0.1) / 2,
          duration: this._animationSpeed,
          mode: Clutter.AnimationMode.EASE_OUT,
          onComplete: () => {
            this._visible = false;
            try {
              this.mainContainer?.hide();
            } catch (err) {
              console.log(`search-light: hide onComplete: ${err}`);
            }
            this._setUnredirect(false);
          },
        });
      } catch (err) {
        // ease() can throw if the actor was destroyed mid-animation
        // (fast logout on Wayland). Fall through to the instant path.
        console.log(`search-light: hide animation failed: ${err}`);
        this._hideInstant();
      }
    } else {
      this._hideInstant();
    }
    // this._hidePopups();
  }

  _hideInstant() {
    try {
      if (this.mainContainer) {
        this.mainContainer.opacity = 0;
        this.mainContainer.hide();
      }
    } catch (err) {
      console.log(`search-light: instant hide failed: ${err}`);
    }
    this._visible = false;
    this._setUnredirect(false);
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
        this.monitor.height - padding * 2,
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
    const monitors = Main.layoutManager?.monitors || [];
    if (!monitors.length) return;

    let idx = this.preferred_monitor || 0;
    if (idx === 0) {
      idx = Main.layoutManager.primaryIndex;
    } else if (idx === Main.layoutManager.primaryIndex) {
      idx = 0;
    }
    this.monitor =
      monitors[idx] || Main.layoutManager.primaryMonitor || monitors[0];

    if (this.popup_at_cursor_monitor) {
      try {
        const pointer = global.get_pointer();
        for (const m of monitors) {
          if (
            pointer[0] >= m.x &&
            pointer[0] <= m.x + m.width &&
            pointer[1] >= m.y &&
            pointer[1] <= m.y + m.height
          ) {
            this.monitor = m;
            break;
          }
        }
      } catch (err) {
        console.log(`search-light: pointer query failed: ${err}`);
      }
    }

    if (!this.monitor) return;
    this.sw = this.monitor.width;
    this.sh = this.monitor.height;

    if (this._last_monitor_count !== monitors.length) {
      try {
        this._settings?.set_int('monitor-count', monitors.length);
      } catch (err) {
        console.log(`search-light: cannot store monitor-count: ${err}`);
      }
      this._last_monitor_count = monitors.length;
    }
  }

  _acquire_ui() {
    if (this._entry || !this.container) return;
    // Overview may be mid-teardown during logout; bail instead of throwing.
    if (!Main.overview?.searchEntry || !Main.overview?.searchController) {
      console.log('search-light: overview search UI unavailable; skipping');
      return;
    }

    if (!Main.overview._toggle) {
      Main.overview._toggle = Main.overview.toggle;
    }
    Main.overview.toggle = () => {
      try {
        if (this._search?.visible) {
          this._search._text?.get_parent()?.grab_key_focus();
        }
      } catch (err) {
        console.log(`search-light: overview toggle forward failed: ${err}`);
      }
    };
    if (!Main.overview._hide) {
      Main.overview._hide = Main.overview.hide;
    }
    Main.overview.hide = () => {
      try {
        if (this.mainContainer) this.mainContainer.opacity = 0;
      } catch {
        // Container already destroyed.
      }
      Main.overview._hide();
    };

    this._queryDisplay();

    try {
      this.scaleFactor =
        St.ThemeContext.get_for_stage(global.stage).scale_factor;
    } catch {
      this.scaleFactor = 1;
    }

    this._entry = Main.overview.searchEntry;
    this._entryParent = this._entry.get_parent();
    try {
      this._entry.add_style_class_name('slc');
    } catch (err) {
      console.log(`search-light: cannot style entry: ${err}`);
    }

    this._search = Main.overview.searchController;

    try {
      this._search.hide();
    } catch (err) {
      console.log(`search-light: cannot hide overview search: ${err}`);
    }
    this._searchResults = this._search._searchResults;
    this._searchParent = this._search.get_parent();
    if (!this._searchResults) {
      console.log('search-light: no search results container found');
      return;
    }

    if (!this._searchResults._activateDefault) {
      this._searchResults._activateDefault =
        this._searchResults.activateDefault;
    }
    this._searchResults.activateDefault = () => {
      // hide window immediately when activated
      try {
        if (this.mainContainer) this.mainContainer.opacity = 0;
      } catch {
        // Already hidden/destroyed.
      }
      this._searchResults._activateDefault();
    };

    try {
      if (this._entry.get_parent()) {
        this._entry.get_parent().remove_child(this._entry);
      }
      this.container.add_child(this._entry);
      if (this._search.get_parent()) {
        this._search.get_parent().remove_child(this._search);
      }
      this.container.add_child(this._search);
    } catch (err) {
      console.log(`search-light: cannot reparent search UI: ${err}`);
      return;
    }
    if (!this._search.__searchCancelled) {
      this._search.__searchCancelled = this._search._searchCancelled;
      this._search._searchCancelled = () => {};
    }
    try {
      this._search._text?.get_parent()?.grab_key_focus();
    } catch (err) {
      console.log(`search-light: cannot focus search entry: ${err}`);
    }
    try {
      this._textChangedEventId = this._search._text.connect(
        'text-changed',
        () => {
          try {
            this.container?.set_size(this.width, this.height);
            this.mainContainer?.set_size(this.width, this.height);
          } catch (err) {
            console.log(`search-light: resize on text-changed failed: ${err}`);
          }
          if (this._corners) {
            this._corners[2].y = this.height - this._corners[1].height;
            this._corners[3].y = this.height - this._corners[1].height;
            this._edges[3].y = this.height - 2;
          }
          try {
            this._search?.show();
          } catch (err) {
            console.log(`search-light: search show failed: ${err}`);
          }
        },
      );
    } catch (err) {
      console.log(`search-light: cannot watch search text: ${err}`);
    }

    try {
      this._search._text?.get_parent()?.grab_key_focus();
    } catch {
      // Focus will land on show() via _toggle_search_light fallback.
    }
  }

  _release_ui() {
    if (this._entry) {
      try {
        if (this._entry.get_parent()) {
          this._entry.get_parent().remove_child(this._entry);
        }
        // _entryParent may be gone during overview teardown (logout).
        if (this._entryParent) {
          this._entryParent.add_child(this._entry);
        }
        try {
          this._entry.remove_style_class_name('slc');
        } catch {
          // Style class was never applied or actor is finalized.
        }
      } catch (err) {
        console.log(`search-light: cannot restore search entry: ${err}`);
      }
      this._entry = null;
      this._entryParent = null;
    }

    if (this._search) {
      try {
        this._removeProviders();
      } catch (err) {
        console.log(`search-light: remove providers on release: ${err}`);
      }
      try {
        this._search.hide();
      } catch {
        // Already hidden.
      }
      try {
        if (this._search.get_parent()) {
          this._search.get_parent().remove_child(this._search);
        }
        if (this._searchParent) {
          this._searchParent.add_child(this._search);
        }
      } catch (err) {
        console.log(`search-light: cannot restore search controller: ${err}`);
      }
      if (this._textChangedEventId) {
        try {
          this._search._text?.disconnect(this._textChangedEventId);
        } catch {
          // Text actor already finalized.
        }
        this._textChangedEventId = null;
      }
      if (this._search.__searchCancelled) {
        this._search._searchCancelled = this._search.__searchCancelled;
        this._search.__searchCancelled = null;
      }
      this._search = null;

      if (this._searchResults?._activateDefault) {
        this._searchResults.activateDefault =
          this._searchResults._activateDefault;
        this._searchResults._activateDefault = null;
      }
      this._searchResults = null;
      this._searchParent = null;
    }

    if (Main.overview?._toggle) {
      Main.overview.toggle = Main.overview._toggle;
      Main.overview._toggle = null;
    }
    if (Main.overview?._hide) {
      Main.overview.hide = Main.overview._hide;
      Main.overview._hide = null;
    }
  }

  _updateCss(disable) {
    // Called from show() and from settings changes; any of these actors
    // may be null during enable()/disable() transitions.
    if (!this.container || !this._background || !this._style) return;
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

    try {
      this._background.remove_effect_by_name('blur');
    } catch {
      // No blur effect attached; nothing to remove.
    }
    if (this._blurEffect && this.blur_background) {
      try {
        this._background.add_effect_with_name('blur', this._blurEffect);
        this._blurEffect.color = bg;
      } catch (err) {
        console.log(`search-light: cannot apply blur effect: ${err}`);
      }
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

    // Only reference the blurred snapshot once ImageMagick has actually
    // produced it; otherwise St logs a failed-texture warning every show().
    // The file:// URI form is required by St's background-image parser.
    const blurredExists =
      this.blur_background &&
      this.desktop_background_blurred &&
      this.monitor &&
      Gio.File.new_for_path(this.desktop_background_blurred).query_exists(
        null,
      );
    if (blurredExists) {
      let sw = this.monitor.width;
      let sh = this.monitor.height;
      let ss = [];
      // ss.push(`\n background-image: url("${BLURRED_BG_PATH}");`);
      ss.push(
        `\n background-image: url("${this.desktop_background_blurred}");`,
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
          `#searchLightBox > StEntry, #searchLightBox > StEntry:focus { font-size: ${f}pt !important; }`,
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

  /**
   * Wire focus/key handlers for the visible popup only. Uses explicit
   * signal IDs (not connectObject) so _removeTransientEvents() can drop
   * exactly these four handlers without touching the persistent
   * overview/app/window-created signals from enable(). Guarded against
   * double-show: a second show() before hide() is a no-op.
   */
  _addTransientEvents() {
    if (this._transientIds?.length) return;
    this._transientIds = [];
    const track = (obj, ...args) => {
      try {
        const id = obj?.connect?.(...args);
        if (id) this._transientIds.push([obj, id]);
      } catch (err) {
        console.log(`search-light: cannot connect ${args[0]}: ${err}`);
      }
    };
    track(global.stage, 'notify::key-focus', this._onKeyFocusChanged.bind(this));
    track(global.stage, 'key-press-event', this._onKeyPressed.bind(this));
    track(global.display, 'notify::focus-window', this._onFocusWindow.bind(this));
    track(global.display, 'in-fullscreen-changed', this._onFullScreen.bind(this));
  }

  _removeTransientEvents() {
    for (const [obj, id] of this._transientIds || []) {
      try {
        obj?.disconnect?.(id);
      } catch {
        // Actor already destroyed; safe to ignore.
      }
    }
    this._transientIds = [];
  }

  // Kept as thin aliases so third-party patches calling the old names keep
  // working; both now operate on transient signals only.
  _add_events() {
    this._addTransientEvents();
  }

  _remove_events() {
    this._removeTransientEvents();
  }

  _onOverviewShowing() {
    this._inOverview = true;
  }

  _onOverviewHidden() {
    this._inOverview = false;
  }

  _onAppStateChanged(st) {
    this._lastAppState = st;
    if (this._visible && this.mainContainer) {
      try {
        this.mainContainer.opacity = 0;
      } catch {
        // Container finalized during app launch; hide() will follow.
      }
    }
  }

  _hidePopups() {
    const popup = this._lastPopup;
    this._lastPopup = null;
    if (!popup || !this._hiTimer) return;
    try {
      let target = popup;
      if (!target.close && target._getTopMenu) {
        target = target._getTopMenu() || target;
      }
      if (!target) return;

      // elaborate way of hiding the popup
      target.opacity = 0;
      this._startupSeq = this._hiTimer.runSequence([
        {
          func: () => {
            try {
              target.opacity = 0;
            } catch {
              // Popup finalized mid-sequence.
            }
          },
          delay: 0,
        },
        {
          func: () => {
            try {
              target._delegate?.close(false);
            } catch (err) {
              console.log(`search-light: popup close failed: ${err}`);
            }
          },
          delay: 250,
        },
      ]);
    } catch (err) {
      console.log(`search-light: hide popups failed: ${err}`);
    }
  }

  _onFocusWindow(w, e) {}

  _onKeyFocusChanged(previous) {
    if (!this._entry || !this._visible) return;
    let focus = null;
    try {
      focus = global.stage.get_key_focus();
    } catch {
      return;
    }
    let appearFocused = false;
    try {
      appearFocused =
        !!focus &&
        (this._entry.contains(focus) ||
          this._searchResults?.contains?.(focus));
    } catch {
      // Actors mid-destruction report contains() errors; treat as unfocused.
      appearFocused = false;
    }

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
      return;
    }

    // hide window immediately when activated
    if (focus && focus.activate) {
      if (!focus._activate) {
        focus._activate = focus.activate;
        focus.activate = () => {
          try {
            if (this.mainContainer) this.mainContainer.opacity = 0;
          } catch {
            // Already hidden.
          }
          focus._activate();
        };
      }
    }
  }

  _onKeyPressed(obj, evt) {
    if (!this._entry || !this._search) return Clutter.EVENT_PROPAGATE;
    let focus = null;
    try {
      focus = global.stage.get_key_focus();
    } catch {
      return Clutter.EVENT_STOP;
    }
    try {
      if (!focus || !this._entry.contains(focus)) {
        if (evt.get_key_symbol() === Clutter.KEY_Escape) {
          this.hide();
          return Clutter.EVENT_STOP;
        }
        this._search._text?.get_parent()?.grab_key_focus();
      }
    } catch (err) {
      console.log(`search-light: key handling failed: ${err}`);
    }

    return Clutter.EVENT_STOP;
  }

  _onFullScreen() {
    if (this._visible) this.hide();
  }
}
