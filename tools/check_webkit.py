#!/usr/bin/env python3
"""Compile a disposable visible WebKit host. No Safari profile, signing or install."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import platform
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--extension', type=Path, help='Exact local extension folder; defaults to current source')
parser.add_argument('--reload-only', action='store_true', help='Native shadows through ordinary reload')
parser.add_argument('--review-state-only', action='store_true', help='Review mirrors the native button through Next and Back')
parser.add_argument('--turn-only', action='store_true', help='Portrait auto-rotation through the real play flow')
parser.add_argument('--comments-only', action='store_true', help='Problem comments in Review on real pages')
parser.add_argument('--coordinates-only', action='store_true', help='Native coordinate labels during actual pan/zoom')
parser.add_argument('--defaults-only', action='store_true', help='Defaults, actual handoff and all Zen mode feedback text')
parser.add_argument('--layout-only', action='store_true', help='Native Zen mode canvas, texture and prompt rendering')
parser.add_argument('--notices-only', action='store_true', help='Native fake-achievement presentation and dismissal checks')
parser.add_argument('--keys-only', action='store_true', help='Focused native keyboard flow without the unrelated resize matrix')
parser.add_argument('--reset-only', action='store_true', help='Show differently with real clicks and the play flow')
parser.add_argument('--taps-only', action='store_true', help='Show taps rings with real mouse presses')
parser.add_argument('--next-only', action='store_true', help='The Next spinner at the live server speed')
parser.add_argument('--fixture', help='Optional authored fixture URL on the existing loopback preview')
args = parser.parse_args()
if args.fixture:
    fixture = urlparse(args.fixture)
    if fixture.scheme not in ['http', 'https'] or not (fixture.hostname in ['localhost', '127.0.0.1'] or
                                                       (fixture.hostname or '').endswith('.localhost')):
        parser.error('Use only the existing confined loopback preview for fixtures.')
extension = (args.extension or ROOT / 'extension').resolve()
output = args.output.resolve()
if output.is_relative_to(ROOT):
    parser.error('Keep generated evidence outside the source tree.')
output.mkdir(parents=True, exist_ok=True)
result = output / 'result.json'
result.unlink(missing_ok=True)
ready = output / 'window-ready'
ready.unlink(missing_ok=True)
metadata = {
    'startedAt': datetime.now(timezone.utc).isoformat(),
    'macOS': platform.mac_ver()[0],
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'runtimeHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in sorted(extension.iterdir()) if p.is_file()},
}
(output / 'source.json').write_text(json.dumps(metadata, indent=2) + '\n')
for name in ['host.log', 'host.err']:
    (output / name).write_text('')
with tempfile.TemporaryDirectory(prefix='zen-webkit-check-') as temporary:
    app = Path(temporary) / 'ZenWebKitCheck.app'
    executable = app / 'Contents/MacOS/ZenWebKitCheck'
    executable.parent.mkdir(parents=True)
    info = {
        'CFBundleIdentifier': 'local.zenmode.webkit-check', 'CFBundleExecutable': executable.name,
        'CFBundleName': 'Zen Mode WebKit check', 'CFBundlePackageType': 'APPL', 'NSPrincipalClass': 'NSApplication',
    }
    if args.fixture and fixture.scheme == 'http':
        info['NSAppTransportSecurity'] = {'NSExceptionDomains': {
            fixture.hostname: {'NSExceptionAllowsInsecureHTTPLoads': True}}}
    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    subprocess.run(['xcrun', 'swiftc', '-parse-as-library', str(ROOT / 'tools/check_webkit.swift'), '-o', str(executable)], check=True)
    launch = subprocess.Popen(['open', '-n', '-W', '-a', str(app), '--stdout', str(output / 'host.log'),
                               '--stderr', str(output / 'host.err'), '--args', str(extension), str(output),
                               str(ROOT / 'tools/webkit-check.js'), *([args.fixture] if args.fixture else []), *(['--keys-only'] if args.keys_only else []), *(['--notices-only'] if args.notices_only else []), *(['--layout-only'] if args.layout_only else []), *(['--defaults-only'] if args.defaults_only else []), *(['--coordinates-only'] if args.coordinates_only else []), *(['--reload-only'] if args.reload_only else []), *(['--review-state-only'] if args.review_state_only else []), *(['--turn-only'] if args.turn_only else []), *(['--comments-only'] if args.comments_only else []), *(['--reset-only'] if args.reset_only else []), *(['--taps-only'] if args.taps_only else []), *(['--next-only'] if args.next_only else [])])
    for _ in range(100):
        if result.exists() or launch.poll() is not None:
            break
        if ready.exists():
            subprocess.run(['open', '-a', str(app)], check=True)
            break
        time.sleep(.1)
    launch.wait(timeout=110)
    if launch.returncode:
        raise SystemExit(f'Host launch failed: {launch.returncode}')
    if not result.exists():
        raise SystemExit('Host exited without a result; no product pass is recorded.')
    outcome = json.loads(result.read_text())
    print(json.dumps(outcome, indent=2))
    raise SystemExit(0 if outcome['status'] == 'passed' else 2 if outcome['status'] == 'environment-blocked' else 1)
