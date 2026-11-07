# Zen Mode

A browser extension that gives [tsumego.com](https://tsumego.com) a calm, full-screen solving view, made first for phones.


https://github.com/user-attachments/assets/c9000ae7-1ee2-4af9-a282-eef6c15f5297


## What it does

- **Minimal UI:** the board fills the screen, with one small bar for the problem, Reset and Next. The rest of the site stays one tap away.
- **Continuous:** no relayout jumps and much less flicker when moving to the next problem.
- **Touch-optimised placement:** zooms to the problem so intersections are comfortable to tap, keeps real board edges where they are, and follows the play as it moves.
- **Re-orients when it helps:** a wide problem is turned on a tall screen when that gives clearly larger touch targets.
- **Optional transitions:** a short pan between problems, or none.

The site's own engine, account and progress stay in charge; ••• → Site page shows the original page at any time.

## Status

A proof of concept, not maintained. It is meant as a proposal for how the site could look and behave on small screens, and would be better implemented in tsumego.com itself. It is not affiliated with or endorsed by tsumego.com, and it sends no requests of its own.

## Install

**Chrome (or another Chromium browser):** open the extensions page, turn on Developer mode, choose Load unpacked and select the `extension` folder.

**Safari on iPhone, iPad or Mac:** open `safari/Zen Mode/Zen Mode.xcodeproj` in Xcode, choose your team under Signing & Capabilities, and Run on your device or Mac. Then turn Zen Mode on in Safari's extension settings and allow it on tsumego.com.

## Known limitations

- Player comments are readable, but getting to them is clunky.
- Signed-in features such as mistake training are only lightly tested.
- Safari's fade under its own bars can be tinted but not removed.

## Licence

MIT, see [LICENSE](LICENSE). The tatami texture is an original generated image, also under MIT.

For developers: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
