## ROADMAP

## release 102 (GNOME 50 hardening, tested on Fedora 44 / GNOME 50.4 Wayland)

* confirm GNOME 50 support: no shell-50 API breakage (only metadata bump needed)
* fix transient/persistent signal lifecycle: hide() no longer kills overview/app/display handlers
* guard compositor unredirect for Wayland/no-op Mutter builds
* watch both picture-uri and picture-uri-dark for blurred background
* resolve file:// wallpaper URIs and prefer `magick` over deprecated `convert`
* only set blurred background-image after the snapshot file exists
* fix accelerator leak: ungrab with numeric action id, idempotent enable/disable
* idempotent disable(): every teardown step guarded, overview patches restored
* null-safe acquire/release of searchEntry/searchController across 48/49/50

## release 38

* fork gnome 48 from 47
* add multi-user support
* add fade-in animation
* add blurred background
* add panel icon (with color settings)

## release 16

* add web search (scrapped)
* add unit conversion (scrapped)
* add currency conversion (scrapped)

## release 15

* fix monitor preference

## release 14

* port to gnome 45
* remove blur background (permanently?)
* remove panel icon (temporarily?)

## release 11

* fix close on enter/click

## release 9

* add panel search icon
* fix close on escape

## release 8

* fix follow cursor, preferred monitor

## release 7

* improve background blurring
* add custom text color
* fix scroll issue
* fix fullscreen issue

## release 5

* add window borders
* add background blur
* add font-size settings

## release 4

* takes gnome's search outside of overview
* custom search window size
* bind to super+custom keys
* bind to preferred monitor or to cursor
