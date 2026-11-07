#!/usr/bin/env python3
"""Set the Safari apps' and extensions' version from extension/manifest.json.

MARKETING_VERSION (CFBundleShortVersionString) is the extension version, and
CURRENT_PROJECT_VERSION (CFBundleVersion) a build number derived from it, so Settings,
devicectl and the app window cannot drift from what the extension runs.
Usage: sync_version.py [project.pbxproj ...]   (default: the repository's project)
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'safari/Zen Mode/Zen Mode.xcodeproj/project.pbxproj'

def versions():
    version = json.loads((ROOT / 'extension/manifest.json').read_text())['version']
    major, minor, patch = (int(part) for part in version.split('.'))
    return version, str(major * 10000 + minor * 100 + patch)  # major.minor.patch as one always-rising build number

def sync(path):
    version, build = versions()
    text = path.read_text()
    new = re.sub(r'MARKETING_VERSION = [^;]+;', f'MARKETING_VERSION = {version};', text)
    new = re.sub(r'CURRENT_PROJECT_VERSION = [^;]+;', f'CURRENT_PROJECT_VERSION = {build};', new)
    if new.count(f'MARKETING_VERSION = {version};') == 0: raise SystemExit(f'No MARKETING_VERSION in {path}')
    if new != text: path.write_text(new)
    return version, build

if __name__ == '__main__':
    for target in [Path(p) for p in sys.argv[1:]] or [DEFAULT]:
        print(target, *sync(target))
