'use strict';

import Gio from 'gi://Gio';
import St from 'gi://St';
import Metric from './metric.js';

const metric = Metric();

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

function toCamelCase(phrase) {
  // Split the phrase by spaces
  const words = phrase.split(' ');

  // Capitalize the first letter of each word after the first one
  for (let i = 1; i < words.length; i++) {
    words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
  }

  // Join the words to form the camel case string
  const camelCaseString = words.join('');

  return camelCaseString;
}

function parse_and_convert(q) {
  try {
    let res = p.exec(q);
    let value = Number(res[1]);
    let unitFrom = get_unit(res[2]);
    let unitTo = get_unit(res[res.length - 1]);
    if (value && unitFrom && unitTo) {
      // console.log(value);
      // console.log(unitFrom);
      // console.log(unitTo);
      let hasDecimals = res[1].indexOf('.') != -1;
      let unitFromName = toCamelCase(unitFrom.name);
      let converter =
        metric[unitFromName] ||
        metric[`${unitFromName}s`] ||
        metric[`${unitFromName}es`];
      if (converter) {
        converter = converter.bind(metric);
        let convertFrom = converter(value);
        let unitToName = toCamelCase(unitTo.name);
        if (convertFrom) {
          let fn = `to${ucfirst(unitToName)}`;
          let convertTo =
            convertFrom[fn] || convertFrom[`${fn}s`] || convertFrom[`${fn}es`];
          if (convertTo) {
            let res = convertTo().toFixed(6);
            if (!hasDecimals && Math.round(res) == res) {
              res = Math.trunc(res);
            }
            return {
              value,
              unitFrom,
              unitTo,
              result: res,
            };
          }
        }
      }
    }
  } catch (err) {
    console.log(err);
  }
  return null;
}

export const UnitConversionProvider = class {
  constructor() {
    let r = parse_and_convert('30 meters to inch');
    console.log(r);
  }

  // createResultObject(resultMeta) {
  //   return new St.Button({});
  // }

  getResultMetas(results, cancellable) {
    let metas = results.map((q) => {
      // if (q == 'copy') {
      //   return {
      //     id: 'copy',
      //     name: 'Copy',
      //     description: 'copy me',
      //     clipboardText: 'hey!',
      //     createIcon: (size) => {
      //       let gicon = Gio.icon_new_for_string('org.gnome.Terminal');
      //       if (gicon) {
      //         return new St.Icon({ gicon, icon_size: size });
      //       }
      //       return null;
      //     }
      //   };
      // }

      let r = parse_and_convert(q);
      return {
        id: q,
        name: `${r.result}`,
        description: `\n${r.value} ${r.unitFrom.name} to ${r.unitTo.name}`,
        clipboardText: `${r.result}`,
        createIcon: (size) => {
          let gicon = Gio.icon_new_for_string('org.gnome.Terminal');
          if (gicon) {
            let icon = new St.Icon({ gicon, icon_size: size });
            // let icon = new St.Widget({width:size*4, height:size*2});
            // icon.style = 'border:2px solid red';
            return icon;
          }
          return null;
          // return new St.Widget({width:size*2, height:size*2});
        },
      };
    });

    // console.log(JSON.stringify(metas));
    return new Promise((resolve) => resolve(metas));
  }

  filterResults(results, maxNumber) {
    return results.slice(0, maxNumber);
  }

  getInitialResultSet(terms, cancellable) {
    let results = [];
    let query = terms.join(' ');
    results.push(query);
    // results.push('copy');
    return new Promise((resolve) => resolve(results));
  }

  getSubsearchResultSet(previousResults, terms, cancellable) {
    return this.getInitialResultSet(terms, cancellable);
  }
};
