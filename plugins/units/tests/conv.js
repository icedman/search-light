#!/usr/bin/gjs

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const GtkClutter = imports.gi.GtkClutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

// Get application folder and add it into the imports path
function getAppFileInfo() {
  let stack = new Error().stack,
    stackLine = stack.split('\n')[1],
    coincidence,
    path,
    file;

  if (!stackLine) throw new Error('Could not find current file (1)');

  coincidence = new RegExp('@(.+):\\d+').exec(stackLine);
  if (!coincidence) throw new Error('Could not find current file (2)');

  path = coincidence[1];
  file = Gio.File.new_for_path(path);
  return [file.get_path(), file.get_parent().get_path(), file.get_basename()];
}
const path = getAppFileInfo()[1];
imports.searchPath.push(path);
imports.searchPath.push(path + '/../');

const metric = imports.metric.Metric;

// let birthday = new Date("1977-03-10T00:00:00Z").getTime()
// let age = metric.milliseconds(Date.now() - birthday).toYears() // 21.38...
// log(age);

// log(Object.keys(metric.meters(32)));
// log(Object.keys(metric.units['distance']));

function ucfirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function get_unit(m) {
  let unitTypes = Object.keys(metric.units);
  for (let i = 0; i < unitTypes.length; i++) {
    let ut = metric.units[unitTypes[i]];
    let skeys = Object.keys(ut);
    for (let j = 0; j < skeys.length; j++) {
      let key = skeys[j];
      // short
      if (key === m) {
        return ut[key];
      }
      // long
      if (m.length > 2 && m.startsWith(ut[key].name)) {
        return ut[key];
      }
    }
  }
  return null;
}

const p = /([0-9\.]*)\s{0,4}([a-z]*)\s{0,4}(to){0,1}\s{0,4}([a-z]*)/;

function parse_and_convert(q) {
  try {
    let res = p.exec(q);
    let value = Number(res[1]);
    let unitFrom = get_unit(res[2]);
    let unitTo = get_unit(res[res.length - 1]);
    if (value && unitFrom && unitTo) {
      // log(value);
      // log(unitFrom);
      // log(unitTo);
      let hasDecimals = res[1].indexOf('.') != -1;
      let converter =
        metric[unitFrom.name] ||
        metric[`${unitFrom.name}s`] ||
        metric[`${unitFrom.name}es`];
      if (converter) {
        converter = converter.bind(metric);
        let convertFrom = converter(value);
        if (convertFrom) {
          let fn = `to${ucfirst(unitTo.name)}`;
          let convertTo =
            convertFrom[fn] ||
            convertFrom[`${fn}s`] ||
            convertFrom[`${fn}es`];
          if (convertTo) {
            let res = convertTo().toFixed(6);
            if (!hasDecimals && Math.round(res) == res) {
              res = Math.trunc(res);
            }
            return {
              value,
              unitFrom,
              unitTo,
              result: res
            }
          }
        }
      }
    }
  } catch (err) {
    // log(err);
  }
  return null;
}

const stdout = new Gio.DataInputStream({
  base_stream: new Gio.UnixInputStream({ fd: 0 }),
});

while (true) {
  let l = stdout.read_line_utf8(null);
  let ll = l[0];
  if (ll == 'q') break;
  if (ll == '?') ll = '32 in to m';
  log(parse_and_convert(ll));
}
