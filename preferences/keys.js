'use strict';

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { PrefKeys } = Me.imports.preferences.prefKeys;

var schemaId = 'org.gnome.shell.extensions.search-light';

var SettingsKeys = new PrefKeys();
SettingsKeys.setKeys({
  'border-radius': {
    default_value: 0,
    widget_type: 'scale',
  },
  'scale-width': {
    default_value: 0.2,
    widget_type: 'scale',
  },
  'scale-height': {
    default_value: 0.2,
    widget_type: 'scale',
  },
  'background-color': {
    default_value: [0, 0, 0, 0.5],
    widget_type: 'color',
  },
  'preferred-monitor': {
    default_value: 0,
    widget_type: 'dropdown',
    test: { values: [0, 1, 2] },
  },
  'msg-to-ext': {
    default_value: '',
    widget_type: 'string',
  },
  'shortcut-search': {
    default_value: [],
    widget_type: 'shortcut',
  },
});
