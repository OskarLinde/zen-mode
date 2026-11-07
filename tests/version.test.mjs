import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// tools/sync_version.py sets the Safari apps' version from the manifest. They must match.
test('Safari project version matches the extension manifest', async () => {
  const { version } = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const project = await readFile(new URL('../safari/Zen Mode/Zen Mode.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const [major, minor, patch] = version.split('.').map(Number);
  const marketing = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1]);
  const builds = [...project.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(m => m[1]);
  assert.ok(marketing.length >= 4);
  assert.deepEqual(new Set(marketing), new Set([version]));
  assert.deepEqual(new Set(builds), new Set([String(major * 10000 + minor * 100 + patch)]));
});
