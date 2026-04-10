<br/>
<p align="center">
  <h3 align="center">Search Light</h3>

  <p align="center">
    A GNOME Shell extension (GNOME Shell 48–50)
    <br/>
    <br/>
  </p>
</p>

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/icedman)

![Contributors](https://img.shields.io/github/contributors/icedman/search-light?color=dark-green) ![Forks](https://img.shields.io/github/forks/icedman/search-light?style=social) ![Stargazers](https://img.shields.io/github/stars/icedman/search-light?style=social) ![Issues](https://img.shields.io/github/issues/icedman/search-light) ![License](https://img.shields.io/github/license/icedman/search-light)

![First Release](https://raw.githubusercontent.com/icedman/search-light/main/screenshots/Screenshot%20from%202022-11-03%2011-53-28.png)

This is a GNOME Shell extension that takes the applications search widget out of Overview, similar to macOS Spotlight or Alfred.

### Compatibility

- **GNOME Shell 48, 49, and 50** are supported on this branch (see `shell-version` in `metadata.json`).
- Older GNOME releases may be available on other branches (for example upstream’s `gnome-47` or `g44`); check the repository branches if you are not on GNOME 48+.

### Features

- Popup search box outside Overview
- Colors, background, and border customization
- Optional blurred background (requires ImageMagick)
- Multi-monitor support (preferred monitor or cursor monitor)
- Primary and secondary keyboard shortcuts (configured in preferences)
- Optional panel search icon

## Blurred background

The blurred background option requires **ImageMagick** (`convert`) so the extension can generate a blurred copy of the desktop wallpaper.

## Installation

**Before installing**, run checks from the repository root:

```bash
make test
```

That runs a strict GSettings schema compile and ESLint. Fix any failures before installing.

Manual installation:

```bash
git clone https://github.com/icedman/search-light
cd search-light
make test
make install
gnome-extensions enable search-light@icedman.github.com
```

GNOME Shell **50** is Wayland-oriented; after installing or upgrading the extension, **log out and back in** (or restart GNOME Shell) so the session loads the updated code.

If you copy files with `make install`, the **Extensions** app may not list the extension until the next login. You can also install from a zip produced by `make publish` using `gnome-extensions install --force search-light@icedman.github.com.zip` (requires `zip` or Python for the zip step; see the `Makefile`).

From the GNOME Extensions site: [Search Light on extensions.gnome.org](https://extensions.gnome.org/extension/5489/search-light/)

## Keybindings

- Default: **Ctrl+Super+Space** (see `shortcut-search` / `secondary-shortcut-search` in preferences). If no shortcut is stored in settings, that default is used.
- **Super** is the Windows or Command key; it is often labeled “Super” on Linux keyboards.
- Set or change shortcuts under the extension’s preferences (Extensions app → Search Light → settings).

## Developing and manual UI harnesses

- `make build` — `glib-compile-schemas --strict` into `schemas/`
- `make lint` — ESLint
- `make test` — `build` then `lint`
- From the repo root, with a graphical session: `gjs tests/test_prefs.js` or `gjs tests/test_prefs_legacy.js` to smoke-test loading preference UI files (interactive windows).

## Credits

Blur-My-Shell for background blurring ideas and shader-related code.
