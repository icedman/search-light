'use strict';

import Soup from 'gi://Soup';
import Gio from 'gi://Gio';
import St from 'gi://St';
import { trySpawnCommandLine } from 'resource:///org/gnome/shell/misc/util.js';

const p1 = /([a-zA-Z]*)\s{0,4}([0-9\.]*)\s{0,4}(to){0,1}\s{0,4}([a-zA-Z]*)/;
const p2 = /([0-9\.]*)\s{0,4}([a-zA-Z]*)\s{0,4}(to){0,1}\s{0,4}([a-zA-Z]*)/;

// prettier-ignore
const cachedRates = {"provider":"https://www.exchangerate-api.com","WARNING_UPGRADE_TO_V6":"https://www.exchangerate-api.com/docs/free","terms":"https://www.exchangerate-api.com/terms","base":"USD","date":"2024-04-02","time_last_updated":1712016001,"rates":{"USD":1,"AED":3.67,"AFN":71.21,"ALL":95.61,"AMD":392.75,"ANG":1.79,"AOA":843.21,"ARS":857.42,"AUD":1.54,"AWG":1.79,"AZN":1.7,"BAM":1.82,"BBD":2,"BDT":109.72,"BGN":1.82,"BHD":0.376,"BIF":2860.01,"BMD":1,"BND":1.35,"BOB":6.92,"BRL":5.01,"BSD":1,"BTN":83.41,"BWP":13.75,"BYN":3.27,"BZD":2,"CAD":1.36,"CDF":2741.94,"CHF":0.905,"CLP":979.23,"CNY":7.25,"COP":3850.97,"CRC":502.76,"CUP":24,"CVE":102.61,"CZK":23.52,"DJF":177.72,"DKK":6.94,"DOP":59.17,"DZD":134.69,"EGP":47.18,"ERN":15,"ETB":56.74,"EUR":0.931,"FJD":2.26,"FKP":0.796,"FOK":6.94,"GBP":0.796,"GEL":2.69,"GGP":0.796,"GHS":13.26,"GIP":0.796,"GMD":67.64,"GNF":8543.88,"GTQ":7.8,"GYD":209.39,"HKD":7.82,"HNL":24.68,"HRK":7.01,"HTG":132.9,"HUF":367.02,"IDR":15923.76,"ILS":3.69,"IMP":0.796,"INR":83.41,"IQD":1308.05,"IRR":42069.91,"ISK":139.32,"JEP":0.796,"JMD":153.94,"JOD":0.709,"JPY":151.56,"KES":131.37,"KGS":89.38,"KHR":4044.51,"KID":1.54,"KMF":457.8,"KRW":1353.03,"KWD":0.308,"KYD":0.833,"KZT":447.08,"LAK":20813.74,"LBP":89500,"LKR":299.82,"LRD":193.55,"LSL":18.95,"LYD":4.84,"MAD":10.09,"MDL":17.65,"MGA":4389.99,"MKD":56.94,"MMK":2102.11,"MNT":3391.89,"MOP":8.06,"MRU":39.8,"MUR":46.41,"MVR":15.42,"MWK":1735.86,"MXN":16.62,"MYR":4.73,"MZN":63.87,"NAD":18.95,"NGN":1302.61,"NIO":36.79,"NOK":10.94,"NPR":133.46,"NZD":1.68,"OMR":0.384,"PAB":1,"PEN":3.72,"PGK":3.8,"PHP":56.25,"PKR":278.26,"PLN":4,"PYG":7355.21,"QAR":3.64,"RON":4.61,"RSD":108.59,"RUB":92.32,"RWF":1287.5,"SAR":3.75,"SBD":8.51,"SCR":13.64,"SDG":453.92,"SEK":10.78,"SGD":1.35,"SHP":0.796,"SLE":22.71,"SLL":22712.78,"SOS":571.34,"SRD":35.32,"SSP":1583.52,"STN":22.8,"SYP":12902.4,"SZL":18.95,"THB":36.54,"TJS":10.94,"TMT":3.5,"TND":3.13,"TOP":2.35,"TRY":32.27,"TTD":6.78,"TVD":1.54,"TWD":32.03,"TZS":2558.13,"UAH":39.1,"UGX":3890.36,"UYU":37.56,"UZS":12634.36,"VES":36.26,"VND":24833.49,"VUV":118.54,"WST":2.73,"XAF":610.4,"XCD":2.7,"XDR":0.755,"XOF":610.4,"XPF":111.04,"YER":250.34,"ZAR":18.95,"ZMW":25.03,"ZWL":20853.85}};
const providerIcon = 'accessories-calculator';
// const providerIcon = 'org.gnome.Terminal';

export const CurrencyConversionProvider = class {
  constructor() {
    this._results = {};
    this._rates = cachedRates;
  }

  initialize() {
    // this.updateRates(true);
  }

  updateRates(refresh = false) {
    if (this._rates && !refresh) {
      return this._rates;
    }

    try {
      console.log('fetching update exchange rates -----');
      let session = new Soup.Session();
      let msg = Soup.Message.new(
        'GET',
        'https://api.exchangerate-api.com/v4/latest/USD'
      );
      let response = session.send(msg, null);
      let read = Gio.DataInputStream.new(response);
      let line = read.read_line_utf8(null);
      if (!line || !line[0]) return { error: true };
      this._rates = JSON.parse(line[0]);
      return this._rates;
    } catch (err) {
      console.log(err);
    }

    return this._rates || cachedRates;
  }

  parseAndConvert(q) {
    try {
      let res = p2.exec(q);

      let from = res[2].toUpperCase();
      let amount = Number(res[1] || 0);
      let to = res[4].toUpperCase();

      if (!from || !amount || !to) {
        return null;
      }

      let rates = this.updateRates(false);
      // fetch latest rates
      if (rates.rates[from] && rates.rates[to]) {
        let dateNow = new Date();
        let shouldRefresh = true;
        if (this.lastUpdate) {
          let diff = dateNow - this.lastUpdate;
          if (diff < 1000 * 60 * 60 * 24) {
            shouldRefresh = false;
          }
        }
        rates = this.updateRates(shouldRefresh);
        if (shouldRefresh) {
          this.lastUpdate = dateNow;
        }
      }

      let amountToUSD = amount * rates.rates[from];
      let converted = amountToUSD * rates.rates[to];

      if (isNaN(converted)) return null;

      console.log(`${from} ${amount} to ${to}`);
      console.log(converted);

      return {
        value: amount,
        currencyFrom: from,
        currencyTo: to,
        result: converted,
      };
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

  // createResultObject(resultMeta) {
  //   return new St.Widget({style:'border: 2px solid red;', width: 80, height: 80});
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
                description: `\n${r.value} ${r.currencyFrom} to ${r.currencyTo}`,
                result: r.result,
                clipboardText: `${r.result}`,
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
