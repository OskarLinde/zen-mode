# Development

A short technical overview, for anyone porting the behaviour into the site.

## How it hooks into the page

The extension runs only on tsumego.com problem pages and changes no data.

- `content.js` runs at document start. It checks the route, applies the saved
  preferences as `data-zen…` attributes on `<html>`, and injects `bridge.mjs` into
  the page.
- `bridge.mjs` runs in the page itself, next to the site's BesoGo editor. It reads
  the problem tree, frames and fits the board, builds the bottom bar and settings,
  and drives the site's own controls (Reset, Next, Review, coordinates, rotation).
- `transition.js` carries a picture of the board across the page load on Next, so
  the change of problem has no relayout or blank frame.
- `zen.css` holds the presentation, all scoped to `html[data-zen="on"]`.

The two worlds talk only through the DOM: `data-zen…` attributes on `<html>` and
`zen:…` events on `document`.

## Modules

- `geometry.mjs`: pure functions for framing and fitting. Which stones and moves
  matter, the crop, the grid step, when to turn the board, and where to place it.
  This is the part most worth porting, and it has unit tests.
- `site-ui.mjs`: the site's menus and sheets, Review and its tree, hearts and
  notices, plus small pure readers of the site's text.
- `bridge.mjs`: the glue between the two above and the page.

## Running it

- Unit tests: `node --test tests/*.test.mjs`.
- Local demo: serve the repository root on a loopback port and open `index.html`.
  It runs the extension's scripts against three demo problems in
  `harness/problems/`, with no extension installed and no network use.
- Browser checks: `tools/check_chrome.mjs` drives Chrome against the local demo and,
  with its `--…-only` options, against live pages. `tools/check_webkit.py` does the
  same in a WebKit host on macOS.

## Packaging

`python3 tools/package_local.py --output <folder> [--safari-wrapper safari]` builds
the Chrome and Firefox packages and the demo bundle from the files the manifest
lists. The Safari project in `safari/` links its resources to `extension/`, so an
Xcode build always uses the current code.

Xcode Run from DerivedData registers a second copy of the extension; remove other
copies first (`pluginkit -m -A -D -v -i local.zenmode.Extension` lists them).
