#!/usr/bin/env python3
"""Build local review packages. Does not install, sign, upload or run a server."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
import sync_version

ROOT = Path(__file__).resolve().parents[1]
DEMO_FILES = [
    'index.html', 'harness/preview.css', 'harness/preview.js',
    'harness/demo-health.js', 'harness/fake-achievements.mjs', 'harness/puzzle.html', 'harness/sample.css',
    'harness/sample.js', 'harness/real.html', 'harness/real.mjs',
    'harness/real-checks.mjs', 'harness/platform-checks.mjs', 'harness/go-problem.mjs',
    'harness/problems/sources.json', 'harness/problems/edge.sgf',
    'harness/problems/double.sgf', 'harness/problems/snapback.sgf', 'harness/problems/wide.sgf',
]
MIME = {'.png': 'image/png', '.html': 'text/html', '.css': 'text/css',
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
        '.sgf': 'text/plain', '.md': 'text/plain'}


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    # The repository's Safari project links its resources to extension/ itself.
    if destination.exists() and destination.resolve() == source.resolve():
        return
    shutil.copyfile(source, destination)
    assert source.read_bytes() == destination.read_bytes()


def archive(path, folder, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        for name in sorted(files):
            output.write(folder / name, folder.name + '/' + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Output directory outside the source tree')
    parser.add_argument('--safari-wrapper', type=Path, help='Existing safari-test folder; preserves project/signing settings')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT):
        parser.error('Use an output directory outside the source tree.')
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    version = manifest['version']
    resources = sorted({'manifest.json',
                        *(name for entry in manifest['content_scripts'] for key in ['js', 'css'] for name in entry.get(key, [])),
                        *(name for entry in manifest['web_accessible_resources'] for name in entry['resources'])})
    for name in resources:
        copy(ROOT / 'extension' / name, output / 'chrome-extension' / name)
        copy(ROOT / 'extension' / name, output / 'firefox-extension' / name)
    firefox = dict(manifest)
    firefox['browser_specific_settings'] = {'gecko': {
        'id': 'zen-mode-local@prototype.invalid',
        'data_collection_permissions': {'required': ['none']},
    }}
    (output / 'firefox-extension/manifest.json').write_text(json.dumps(firefox, indent=2) + '\n')
    for target in ['chrome', 'firefox']:
        archive(output / f'zen-mode-{target}-local.zip', output / f'{target}-extension', resources)
    if args.safari_wrapper:
        wrapper = args.safari_wrapper.resolve()
        embedded = wrapper / 'Zen Mode/Shared (Extension)/Resources'
        if not (embedded / 'manifest.json').is_file():
            parser.error('Expected the existing Safari wrapper; no project will be generated.')
        # Xcode lists resources file by file. A file missing here would be copied but
        # not shipped, and the extension would only fail when Safari ran it.
        # The apps carry the extension's version, so Settings and devicectl show it.
        sync_version.sync(wrapper / 'Zen Mode/Zen Mode.xcodeproj/project.pbxproj')
        project = (wrapper / 'Zen Mode/Zen Mode.xcodeproj/project.pbxproj').read_text()
        missing = [name for name in resources if name not in project]
        if missing:
            parser.error(f'Not in the Xcode project: {", ".join(missing)}. Add them to both targets first.')
        for name in resources:
            for destination in [embedded] + ([wrapper / 'extension'] if (wrapper / 'extension').is_dir() else []):
                copy(ROOT / 'extension' / name, destination / name)
        files = [p.relative_to(wrapper).as_posix() for p in wrapper.rglob('*') if p.is_file()
                 and not any(part in ['.DS_Store', 'xcuserdata', 'DerivedData'] for part in p.relative_to(wrapper).parts)]
        archive(output / 'zen-mode-safari-test.zip', wrapper, files)
    demo = output / 'iphone-demo'
    files = DEMO_FILES + ['extension/' + n for n in resources if n != 'manifest.json']
    for name in files:
        copy(ROOT / name, demo / name)
    (demo / 'README.md').write_text(f'''# Zen Mode {version} — local UI demo

This is a three-problem local selection, not live tsumego.com or account progress.
Keep it unpublished. Sources and unchanged SGFs are under Source & details.

On your Mac, run `python3 "{demo / 'serve.py'}"`.
Use the same private Wi-Fi, keep the Mac awake, and scan the QR in the browser
window that opens. The direct puzzle URL ends in `/harness/real.html?p=0`.
Allow local-network access if macOS asks. Stop with Ctrl-C. Restart the launcher
after replacing this bundle; it holds its original files in memory.
No extension or Xcode is needed for this demo. The Mac needs Python 3.
If automatic address selection fails, use `--bind <your-Mac-private-IPv4>`.
`--check` verifies bundled hashes without starting a listener. `--no-open`
prints the QR page URL without opening it. No tunnel, workspace exposure or directory
listing is provided; only listed assets are served.

Missing view preferences default to Site theme, Small (⅓-grid) edge margin,
and Pan & crossfade; Outside board remains Auto. Saved choices are preserved.
Reduced Motion and unsupported browsers use steady/ordinary navigation even
when Pan & crossfade is the requested preference. No account settings change.

Try the multi-step solutions, wrong moves, Reset, Review and manual Next.
For test-only achievement notifications, use Short / Long / 3 popups in the
workbench, or ••• → Source & details on the direct demo. Tap a card or its × to
dismiss; the bottom controls should stay usable. These samples award nothing.
Zen mode fills the available viewport; ••• → Site page restores the local demo’s
regular page without resetting. Zen mode returns. The chosen mode persists.
History stays in the menu; a check beside the number appears after local success.
The turn stone follows the visible Black/White instruction. Native account
semantics are not simulated by the demo’s illustrative history/hearts.

Phone thumb placement remains limited to narrow viewports. Coordinates,
Full board, manual zoom, optional edge margin, glass and motion remain in •••.
Review alone expands the tree/navigation panel. Motion is optional and must
fall back to ordinary navigation in browsers without cross-document transitions.
The wide layout is a viewport feature, not removal of browser-owned chrome.

The workbench `/index.html` offers viewport fixtures and local behavior checks.
Those checks do not establish physical-device or authenticated-site support.
''')
    files.append('README.md')
    allow = {'/' + n: [MIME[Path(n).suffix] + ('' if n.endswith('.png') else '; charset=utf-8'),
                       hashlib.sha256((demo / n).read_bytes()).hexdigest()] for n in files}
    copy(ROOT / 'tools/make-qr.js', demo / 'make-qr.js')
    template = (ROOT / 'tools/demo-server.py.in').read_text()
    (demo / 'serve.py').write_text(template.replace('@ALLOWLIST@', json.dumps(allow, indent=2))
                                 .replace('@QR_HASH@', repr(hashlib.sha256((demo / 'make-qr.js').read_bytes()).hexdigest())))
    archive(output / 'zen-mode-iphone-demo.zip', demo, files + ['serve.py', 'make-qr.js'])
    hashes = {name: hashlib.sha256((ROOT / 'extension' / name).read_bytes()).hexdigest() for name in resources}
    (output / f'extension-hashes-{version}.json').write_text(json.dumps(hashes, indent=2) + '\n')
    print(f'Local {version}: Chrome, Firefox and demo bundles refreshed; {len(allow)} allowlisted demo files. No server or installation started.')


if __name__ == '__main__':
    main()
