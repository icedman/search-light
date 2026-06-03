// loosely based on JustPerfection & Blur-My-Shell

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

import { ShortcutSettingWidget } from './shortcuts.js';

const GETTEXT_DOMAIN = 'search-light';

import { schemaId, SettingsKeys } from './preferences/keys.js';
import { MonitorsConfig } from './monitors.js';

import {
  ExtensionPreferences,
  gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Preferences extends ExtensionPreferences {
  constructor(metadata) {
    super(metadata);
    let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    let UIFolderPath = `${this.path}/ui`;
    iconTheme.add_search_path(`${UIFolderPath}/icons`);
    // ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
  }

  find(n, name) {
    if (n.get_name() == name) {
      return n;
    }
    let c = n.get_first_child();
    while (c) {
      let cn = this.find(c, name);
      if (cn) {
        return cn;
      }
      c = c.get_next_sibling();
    }
    return null;
  }

  dump(n, l) {
    let s = '';
    for (let i = 0; i < l; i++) {
      s += ' ';
    }
    print(`${s}${n.get_name()}`);
    let c = n.get_first_child();
    while (c) {
      this.dump(c, l + 1);
      c = c.get_next_sibling();
    }
  }

  addMenu(window, builder) {
    // let menu_util = builder.get_object('menu_util');
    // window.add(menu_util);

    // let gwc = this.find(window, 'GtkWindowControls');
    // gwc.visible = false;
    // console.log(gwc);

    let headerbar = this.find(window, 'AdwHeaderBar');
    if (!headerbar) {
      return;
    }
    headerbar.pack_start(builder.get_object('info_menu'));

    // setup menu actions
    const actionGroup = new Gio.SimpleActionGroup();
    window.insert_action_group('prefs', actionGroup);

    // a list of actions with their associated link
    const actions = [
      {
        name: 'open-bug-report',
        link: 'https://github.com/icedman/search-light/issues',
      },
      {
        name: 'open-readme',
        link: 'https://github.com/icedman/search-light',
      },
      {
        name: 'open-buy-coffee',
        link: 'https://www.buymeacoffee.com/icedman',
      },
      {
        name: 'open-license',
        link: 'https://github.com/icedman/search-light/blob/master/LICENSE',
      },
    ];

    actions.forEach((action) => {
      let act = new Gio.SimpleAction({ name: action.name });
      act.connect('activate', (_) =>
        Gtk.show_uri(window, action.link, Gdk.CURRENT_TIME),
      );
      actionGroup.add_action(act);
    });

    // window.remove(menu_util);
  }

  addButtonEvents(window, builder, settings) {
    this._setupBlacklist(window, builder, settings);
  }

  fillPreferencesWindow(window) {
    let builder = new Gtk.Builder();

    let UIFolderPath = `${this.path}/ui`;

    builder.add_from_file(`${UIFolderPath}/general.ui`);
    builder.add_from_file(`${UIFolderPath}/appearance.ui`);
    builder.add_from_file(`${UIFolderPath}/accelerator.ui`);
    builder.add_from_file(`${UIFolderPath}/menu.ui`);
    window.add(builder.get_object('general'));
    window.add(builder.get_object('appearance'));
    window.set_search_enabled(true);

    // builder.get_object("providers-group").visible = false;

    let settings = this.getSettings(schemaId);
    let settingsKeys = SettingsKeys();
    settingsKeys.connectBuilder(builder);
    settingsKeys.connectSettings(settings);

    this.addButtonEvents(window, builder, settings);
    this.addMenu(window, builder);

    this._monitorsConfig = new MonitorsConfig();
    this._monitorsConfig.connect('updated', () => this.updateMonitors());

    // shortcuts widget
    {
      let placeholder = builder.get_object('shortcut-search-placeholder');
      placeholder.append(
        new ShortcutSettingWidget(
          builder.get_object('accelerator'),
          settings,
          'shortcut-search',
          window,
        ),
      );
    }

    {
      let placeholder = builder.get_object(
        'secondary-shortcut-search-placeholder',
      );
      placeholder.append(
        new ShortcutSettingWidget(
          builder.get_object('accelerator'),
          settings,
          'secondary-shortcut-search',
          window,
        ),
      );
    }

    this._builder = builder;
    this.updateMonitors();
  }

  _setupBlacklist(window, builder, settings) {
    let group = builder.get_object('blacklist-group');
    let addBtn = builder.get_object('blacklist-add-btn');

    this._blacklistGroup = group;
    this._blacklistSettings = settings;
    this._blacklistWindow = window;
    this._blacklistRows = [];
    this._refreshBlacklistRows();

    addBtn.connect('clicked', () => {
      this._openAppChooser();
    });
  }

  _refreshBlacklistRows() {
    this._blacklistRows.forEach((row) => {
      this._blacklistGroup.remove(row);
    });
    this._blacklistRows = [];

    let apps = this._blacklistSettings.get_strv('blacklist-apps');
    apps.forEach((appId) => {
      let appInfo = Gio.DesktopAppInfo.new(appId);
      let label = appInfo ? appInfo.get_display_name() : appId;

      let row = new Adw.ActionRow({
        title: label,
        subtitle: appId,
      });

      if (appInfo && appInfo.get_icon()) {
        let icon = new Gtk.Image({
          gicon: appInfo.get_icon(),
          pixel_size: 32,
          margin_end: 8,
        });
        row.add_prefix(icon);
      }

      let removeBtn = new Gtk.Button({
        icon_name: 'list-remove-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
      });
      removeBtn.connect('clicked', () => {
        let current = this._blacklistSettings.get_strv('blacklist-apps');
        current = current.filter((id) => id !== appId);
        this._blacklistSettings.set_strv('blacklist-apps', current);
        this._refreshBlacklistRows();
      });

      row.add_suffix(removeBtn);
      this._blacklistGroup.add(row);
      this._blacklistRows.push(row);
    });
  }

  _getRunningAppIds() {
    let runningCmds = new Set();
    try {
      let procDir = Gio.File.new_for_path('/proc');
      let enumerator = procDir.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NONE,
        null,
      );
      let info;
      while ((info = enumerator.next_file(null)) !== null) {
        let name = info.get_name();
        if (!/^\d+$/.test(name)) continue;
        try {
          let cmdlineFile = Gio.File.new_for_path(`/proc/${name}/cmdline`);
          let [ok, contents] = cmdlineFile.load_contents(null);
          if (ok) {
            let cmdline = new TextDecoder().decode(contents).split('\0')[0];
            let basename = cmdline.split('/').pop();
            if (basename) runningCmds.add(basename);
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      return [];
    }

    let runningIds = [];
    let allApps = Gio.AppInfo.get_all();
    for (let app of allApps) {
      if (!app.should_show()) continue;
      let exe = app.get_executable();
      if (exe && runningCmds.has(exe.split('/').pop())) {
        runningIds.push(app.get_id());
      }
    }
    return runningIds;
  }

  _openAppChooser() {
    let dialog = new Adw.Window({
      modal: true,
      transient_for: this._blacklistWindow,
      title: 'Select Application',
      default_width: 400,
      default_height: 500,
    });

    let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    let headerBar = new Adw.HeaderBar();
    box.append(headerBar);

    let searchEntry = new Gtk.SearchEntry({
      placeholder_text: 'Filter applications\u2026',
      margin_start: 12,
      margin_end: 12,
      margin_top: 6,
      margin_bottom: 6,
    });
    box.append(searchEntry);

    let loadingLabel = new Gtk.Label({
      label: 'Loading application list\u2026',
      vexpand: true,
      valign: Gtk.Align.CENTER,
      css_classes: ['dim-label'],
    });
    box.append(loadingLabel);

    let scrolled = new Gtk.ScrolledWindow({
      vexpand: true,
      visible: false,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    let listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
    });
    listBox.set_filter_func((row) => {
      let text = searchEntry.get_text().toLowerCase();
      if (!text) return true;
      if (!row._appName) return false;
      return row._appName.toLowerCase().includes(text);
    });
    scrolled.set_child(listBox);
    box.append(scrolled);

    searchEntry.connect('search-changed', () => {
      listBox.invalidate_filter();
    });

    dialog.set_content(box);
    dialog.present();

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      this._populateAppChooser(dialog, listBox);
      loadingLabel.visible = false;
      scrolled.visible = true;
      return GLib.SOURCE_REMOVE;
    });
  }

  _populateAppChooser(dialog, listBox) {
    let allApps = Gio.AppInfo.get_all()
      .filter((app) => app.should_show())
      .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));

    let current = this._blacklistSettings.get_strv('blacklist-apps');
    let runningIds = this._getRunningAppIds();

    let runningApps = allApps.filter(
      (app) => runningIds.includes(app.get_id()) && !current.includes(app.get_id()),
    );
    let otherApps = allApps.filter(
      (app) => !runningIds.includes(app.get_id()) && !current.includes(app.get_id()),
    );

    let appendAppRow = (appInfo) => {
      let appId = appInfo.get_id();
      let row = new Adw.ActionRow({
        title: appInfo.get_display_name(),
        subtitle: appId,
      });
      row._appName = appInfo.get_display_name();

      let gicon = appInfo.get_icon();
      if (gicon) {
        row.add_prefix(new Gtk.Image({ gicon, pixel_size: 32, margin_end: 8 }));
      }

      let addBtn = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
      });
      addBtn.connect('clicked', () => {
        let cur = this._blacklistSettings.get_strv('blacklist-apps');
        if (!cur.includes(appId)) {
          cur.push(appId);
          this._blacklistSettings.set_strv('blacklist-apps', cur);
          this._refreshBlacklistRows();
        }
        dialog.close();
      });

      row.add_suffix(addBtn);
      row.set_activatable_widget(addBtn);
      listBox.append(row);
    };

    runningApps.forEach(appendAppRow);

    if (runningApps.length > 0 && otherApps.length > 0) {
      let separatorRow = new Gtk.ListBoxRow({
        selectable: false,
        activatable: false,
      });
      separatorRow.set_child(
        new Gtk.Separator({
          orientation: Gtk.Orientation.HORIZONTAL,
          margin_top: 4,
          margin_bottom: 4,
        }),
      );
      separatorRow._appName = '';
      listBox.append(separatorRow);
    }

    otherApps.forEach(appendAppRow);
  }

  updateMonitors() {
    let monitors = this._monitorsConfig.monitors;
    let count = monitors.length;
    let list = new Gtk.StringList();
    list.append('Primary Monitor');
    for (let i = 0; i < count; i++) {
      let m = monitors[i];
      list.append(m.displayName);
    }
    this._builder.get_object('preferred-monitor').set_model(list);
  }
}
