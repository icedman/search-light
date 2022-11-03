const GLib = imports.gi.GLib;
const Gdk = imports.gi.Gdk;

// todo.. recompute ... seems to length the debounce hold out period
const DEBOUNCE_PRECISION = 1;

const dummy_pointer = {
  get_position: () => {
    return [{}, 0, 0];
  },
  warp: (screen, x, y) => {},
};

var getPointer = () => {
  let display = Gdk.Display.get_default();

  // wayland?
  if (!display) {
    return dummy_pointer;
  }

  let deviceManager = display.get_device_manager();
  if (!deviceManager) {
    return dummy_pointer;
  }
  let pointer = deviceManager.get_client_pointer() || dummy_pointer;
  return pointer;
};

var warpPointer = (pointer, x, y) => {
  let [screen, pointerX, pointerY] = pointer.get_position();
  pointer.warp(screen, x, y);
};

// managed timers

var setTimeout = (func, delay, ...args) => {
  const wrappedFunc = () => {
    func.apply(this, args);
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

var setInterval = (func, delay, ...args) => {
  const wrappedFunc = () => {
    return func.apply(this, args) || true;
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

var clearTimeout = (id) => {
  // log(`clearTimeout ${id}`);
  GLib.source_remove(id);
};

var clearInterval = (id) => {
  // log(`clearInterval ${id}`);
  GLib.source_remove(id);
};

let _running_sequences = [];
let _seq_id = 0xff;

var beginTimer = (seq, name) => {
  if (_running_sequences.findIndex((s) => s._id == seq._id) == -1) {
    if (!seq._id) {
      seq._id = _seq_id++;
    }
    _running_sequences.push(seq);
    // log(`push ${seq._id} ${seq._timeoutId}`);
    // log(`${_running_sequences.map((s)=>s._timeoutId).join(',')}`);
  }
  if (!seq.name) {
    seq.name = name ? name : `timer_${seq._id}`;
  }
  return seq;
};

// run a sequence of codes with delay in between
var runSequence = (seq) => {
  if (typeof seq.length === 'number') {
    seq = {
      sequences: [...seq],
    };
  }
  if (!seq) {
    return null;
  }
  if (seq.sequences.length == 0) {
    seq._timeoutId = null;
    clearSequence(seq);
    return null;
  }

  let t = seq.sequences[0];
  let d = Math.floor(t.delay * 1000);
  t.func(t);

  // seq.sequences.splice(0, 1);
  seq.sequences = [...seq.sequences.slice(1)];

  seq._timeoutId = setTimeout(() => {
    runSequence(seq);
  }, d);

  return seq;
};

// run a single function with delay prior
var runOneShot = (func, delay) => {
  let seq = [
    { func: () => {}, delay: delay },
    { func: func, delay: 0 },
  ];
  return runSequence(seq);
};

// run perpetually until cancelled
var runLoop = (seq, interval) => {
  if (typeof seq == 'function') {
    seq = {
      func: seq,
      delay: interval,
      sequences: [],
    };
  }

  if (!seq._timeoutId) {
    seq._timeoutId = setInterval(() => {
      seq.func(seq);
    }, Math.floor(1000 * seq.delay));
  }

  // log(`loop ${seq._timeoutId}`);
  return seq;
};

// run if after delay, remains uncancelled
var runDebounce = (seq, interval) => {
  if (typeof seq == 'function') {
    seq = {
      func: seq,
      delay: interval,
      sequences: [],
      holdCount: 0,
      hold: false,
    };
  } else {
    seq.holdCount = 0;
    seq.hold = true;
  }

  if (!seq._timeoutId) {
    // log('start debounce timer');
    // debounce now utilizes the same timer,
    // instead of cancelling and creating a new timer
    seq._timeoutId = setInterval(() => {
      if (seq.holdCount >= seq.delay) {
        if (seq.hold) {
          seq.holdCount -= seq.delay;
          seq.hold = false;
          return;
        }
      } else {
        seq.holdCount += seq.delay / DEBOUNCE_PRECISION; // add more precision
        return;
      }

      clearInterval(seq._timeoutId);
      seq._timeoutId = null;
      clearSequence(seq);
      seq.func(seq);
      // log('exec');
    }, Math.floor((1000 * seq.delay) / DEBOUNCE_PRECISION));
  }

  // log(`debounce ${seq._timeoutId}`);
  return seq;
};

var clearSequence = (seq) => {
  if (seq._timeoutId) {
    // log(`clearTimer ${seq._id} ${seq._timeoutId}`);
    clearTimeout(seq._timeoutId);
    seq._timeoutId = null;
  }
  let idx = _running_sequences.findIndex((s) => s._id == seq._id);
  // log(`remove ${seq._id} @ ${idx} ${seq._timeoutId}`);

  if (idx != -1) {
    if (_running_sequences.length == 1) {
      _running_sequences = [];
      return;
    }

    // _running_sequences.splice(seq, 1); << ugh?!!
    _running_sequences = [
      ..._running_sequences.slice(0, idx),
      ..._running_sequences.slice(idx + 1),
    ];
  }

  // log(`more running? ${_running_sequences.length}`);
  // log(`${_running_sequences.map((s)=>s._timeoutId).join(',')}`);
};

var clearAllTimers = () => {
  let guard = 200;
  log('clearing timers...');
  while (_running_sequences.length > 0 && guard-- > 0) {
    clearSequence(_running_sequences[0]);
  }
};

var getRunningTimers = () => {
  return _running_sequences;
};
