// loosely based on JustPerfection & Blur-My-Shell

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

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
        Gtk.show_uri(window, action.link, Gdk.CURRENT_TIME)
      );
      actionGroup.add_action(act);
    });

    // window.remove(menu_util);
  }

  addButtonEvents(window, builder, settings) {
    //
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
          window
        )
      );
    }

    {
      let placeholder = builder.get_object(
        'secondary-shortcut-search-placeholder'
      );
      placeholder.append(
        new ShortcutSettingWidget(
          builder.get_object('accelerator'),
          settings,
          'secondary-shortcut-search',
          window
        )
      );
    }

    this._builder = builder;
    this.updateMonitors();
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
