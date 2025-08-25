import GLib from 'gi://GLib';

// todo.. recompute ... seems to length the debounce hold out period
const DEBOUNCE_PRECISION = 1;

const dummy_pointer = {
  get_position: () => {
    return [{}, 0, 0];
  },
  warp: (screen, x, y) => {},
};

export const getPointer = () => {
  return global.get_pointer();
};

export const warpPointer = (pointer, x, y) => {
  let [screen, pointerX, pointerY] = pointer.get_position();
  pointer.warp(screen, x, y);
};

export const setTimeout = (func, delay, ...args) => {
  const wrappedFunc = () => {
    func.apply(this, args);
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

export const setInterval = (func, delay, ...args) => {
  const wrappedFunc = () => {
    return func.apply(this, args) || true;
  };
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, wrappedFunc);
};

export const clearTimeout = (id) => {
  GLib.source_remove(id);
};

export const clearInterval = (id) => {
  GLib.source_remove(id);
};


export function getBrowserList() {
  return [
    { name: 'System Default', command: 'xdg-open' },
    { name: 'Firefox', command: 'firefox' },
    { name: 'Google Chrome', command: 'google-chrome' },
    { name: 'Chromium', command: 'chromium-browser' },
    { name: 'Opera', command: 'opera' },
    { name: 'Brave', command: 'brave-browser' },
    { name: 'Vivaldi', command: 'vivaldi' },
  ];
}

function isBrowserInstalled(command) {
  try {
    const [success] = GLib.spawn_command_line_sync(`which ${command}`);
    return success;
  } catch (_) {
    return false;
  }
}

export function getAvailableBrowsers() {
  return getBrowserList().filter(b =>
    b.command === 'xdg-open' || isBrowserInstalled(b.command)
  );
}
