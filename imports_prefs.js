function init() {
  ExtensionUtils.initTranslations();
}

function fillPreferencesWindow(window) {
  let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
  iconTheme.add_search_path(`${Me.dir.get_path()}/ui/icons`);
  let p = new Preferences();
  p.path = Me.dir.get_path();
  p.fillPreferencesWindow(window);
}
