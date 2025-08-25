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
import { getAvailableBrowsers } from './utils.js';

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
    //
  }

   setupBrowserCombo(combo, settings, enableSwitch) {
    const browsers = getAvailableBrowsers();
    const browserNames = browsers.map(browser => browser.name);
    const browserList = new Gtk.StringList();
    browserNames.forEach(name => browserList.append(name));
    
    combo.set_model(browserList);
    combo.set_selected(settings.get_int('selected-browser'));
    settings.bind('selected-browser', combo, 'selected', Gio.SettingsBindFlags.DEFAULT);

    //To update combo browser state based on switch
    function updateBrowserComboState() {
      const isEnabled = enableSwitch.active;
      combo.sensitive = isEnabled;
      if (!isEnabled) {
        combo.expanded = false;
      }
    }
    // Hook the switch event to update the state
    enableSwitch.connect('notify::active', updateBrowserComboState);
    updateBrowserComboState();
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

    if (builder.get_object('qr')) {
      builder
        .get_object('qr')
        .set_from_file(`${UIFolderPath}/images/qr_icedman.png`);
    }

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
    const dropdown = builder.get_object('search-engine-combo');
    const searchEngineFile = this.dir.get_child('search-engines.json');
    // Engine Switch 
    let switchWidget = builder.get_object('enable-search-engine-switch');
    settings.bind(
      'enable-search-engine', 
      switchWidget,           
      'active',           
      Gio.SettingsBindFlags.DEFAULT
    );

    const [, contents] = searchEngineFile.load_contents(null);
    const json = JSON.parse(new TextDecoder().decode(contents));
    const searchEngineNames = json.map(d => d.name);
    const enableSearchEngineSwitch = builder.get_object('enable-search-engine-switch');
    const searchEngineCombo = builder.get_object('search-engine-combo');

    //Saved state switche enable/disable search engine.
    settings.bind('enable-search-engine', enableSearchEngineSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    function updateSearchEngineOptions() {
      const isEnabled = enableSearchEngineSwitch.active;
      searchEngineCombo.sensitive = isEnabled;
      if (!isEnabled) {
        searchEngineCombo.expanded = false;
      }
    }
    enableSearchEngineSwitch.connect('notify::active', updateSearchEngineOptions);
    enableSearchEngineSwitch.set_active(settings.get_boolean('enable-search-engine'));
    updateSearchEngineOptions();

    const list = new Gtk.StringList();

    searchEngineNames.forEach(name => list.append(name));
    dropdown.set_model(list);
    dropdown.set_selected(settings.get_int('search-engine'));
    settings.bind('search-engine', dropdown, 'selected', Gio.SettingsBindFlags.DEFAULT);
    updateSearchEngineOptions();

    const browserCombo = builder.get_object('browser-selection-combo');
    this.setupBrowserCombo(browserCombo, settings, enableSearchEngineSwitch);

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
