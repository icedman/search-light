// loosely based on JustPerfection & Blur-My-Shell

const { Adw, Gdk, GLib, Gtk, GObject, Gio, Pango } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const { SettingsKeys } = Me.imports.preferences.keys;
const UIFolderPath = Me.dir.get_child('ui').get_path();
const ShortcutSettingWidget = Me.imports.shortcuts.ShortcutSettingWidget;

const GETTEXT_DOMAIN = 'search-light';
const Gettext = imports.gettext.domain('search-light');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;

const { schemaId, settingsKeys } = Me.imports.preferences.keys;

function init() {
  let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
  iconTheme.add_search_path(`${UIFolderPath}/icons`);
  ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
}

function updateMonitors(window, builder, settings) {
  // monitors
  let count = settings.get_int('monitor-count') || 1;
  const monitors_model = builder.get_object('preferred-monitor-model');
  monitors_model.splice(count, 6 - count, []);
}

function addMenu(window, builder) {
  let menu_util = builder.get_object('menu_util');
  window.add(menu_util);

  const page = builder.get_object('menu_util');
  const pages_stack = page.get_parent(); // AdwViewStack
  const content_stack = pages_stack.get_parent().get_parent(); // GtkStack
  const preferences = content_stack.get_parent(); // GtkBox
  const headerbar = preferences.get_first_child(); // AdwHeaderBar
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

  window.remove(menu_util);
}

function addButtonEvents(window, builder, settings) {
  //
}

function fillPreferencesWindow(window) {
  let builder = new Gtk.Builder();

  builder.add_from_file(`${UIFolderPath}/general.ui`);
  builder.add_from_file(`${UIFolderPath}/appearance.ui`);
  builder.add_from_file(`${UIFolderPath}/accelerator.ui`);
  builder.add_from_file(`${UIFolderPath}/menu.ui`);
  window.add(builder.get_object('general'));
  window.add(builder.get_object('appearance'));
  window.set_search_enabled(true);

  let settings = ExtensionUtils.getSettings(schemaId);

  SettingsKeys.connectBuilder(builder);
  SettingsKeys.connectSettings(ExtensionUtils.getSettings(schemaId));

  addButtonEvents(window, builder, settings);
  updateMonitors(window, builder, settings);
  addMenu(window, builder);

  // shortcuts widget

  let placeholder = builder.get_object('shortcut-search-placeholder');
  placeholder.append(
    new ShortcutSettingWidget(
      builder.get_object('accelerator'),
      settings,
      'shortcut-search'
    )
  );
}
