'use strict';

import Gio from 'gi://Gio';
import St from 'gi://St';
import { trySpawnCommandLine } from 'resource:///org/gnome/shell/misc/util.js';

import { NewMetric } from './metric.js';

const providerIcon = 'accessories-calculator';
// const providerIcon = 'org.gnome.Terminal';

function ucfirst(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
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

export const UnitConversionProvider = class {
  constructor() {
    this.metric = NewMetric();
    this._results = {};
  }

  initialize() {}

  // createResultObject(resultMeta) {
  //   return new St.Button({});
  // }

  activateResult(query, terms) {
    let id = terms.join(' ');
    let meta = this._results[id];

    console.log(meta);

    if (meta.clipboardText) {
      St.Clipboard.get_default().set_text(
        St.ClipboardType.CLIPBOARD,
        meta.clipboardText
      );
    } else {
      trySpawnCommandLine(`gnome-calculator --equation ${meta.result}`);
    }
  }

  get_unit(m) {
    let unitTypes = Object.keys(this.metric.units);
    for (let i = 0; i < unitTypes.length; i++) {
      let ut = this.metric.units[unitTypes[i]];
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

  parseAndConvert(q) {
    try {
      let metric = this.metric;
      let res = p.exec(q);
      let r1 = res[2];
      let r2 = res[res.length - 1];

      let _ns = (a) => {
        a = a.substr(0, a.length - 1) + a.substr(a.length - 1).replace('s', '');
        return a;
      };

      let value = Number(res[1]);
      let unitFrom = this.get_unit(r1) || this.get_unit(_ns(r1));
      let unitTo = this.get_unit(r2) || this.get_unit(_ns(r2));

      if (value && unitFrom && unitTo) {
        console.log(value);
        console.log(unitFrom);
        console.log(unitTo);
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

  parseAndConvertAsync(q) {
    if (q.includes('copy-')) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let res = this.parseAndConvert(q);
      if (res != null) {
        return resolve(res);
      }
      reject();
    });
  }

  getResultMetas(results, cancellable) {
    let promises = [];
    results.forEach((q) => {
      promises.push(
        new Promise((resolve, reject) => {
          this.parseAndConvertAsync(q)
            .then((r) => {
              if (this._results[q]) {
                return resolve(this._results[q]);
              }
              let meta = {
                id: q,
                name: `${q} = ${r.result}`,
                result: r.result,
                description: `\n${r.value} ${r.unitFrom.name} to ${r.unitTo.name}`,
                createIcon: (size) => {
                  let gicon = Gio.icon_new_for_string(providerIcon);
                  if (gicon) {
                    let icon = new St.Icon({
                      gicon,
                      icon_size: 0,
                      visible: false,
                    });
                    return icon;
                  }
                  return null;
                },
              };
              this._results[q] = { ...meta, clipboardText: null };
              this._results[`copy-${q}`] = {
                ...meta,
                name: 'Copy result to clipboard',
              };
              resolve(this._results[q]);
            })
            .catch((err) => {
              reject(err);
            });
        })
      );
    });

    return Promise.all(promises);
  }

  filterResults(results, maxNumber) {
    return results.slice(0, maxNumber);
  }

  getInitialResultSet(terms, cancellable) {
    let results = [];
    let query = terms.join(' ');
    results.push(query);
    results.push(`copy-${query}`);
    return new Promise((resolve) => resolve(results));
  }

  getSubsearchResultSet(previousResults, terms, cancellable) {
    return this.getInitialResultSet(terms, cancellable);
  }
};
