import assert from 'node:assert/strict';
import { cloudSettingsResultGuidance, withCloudSettingsResult } from './result-guidance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const settingsPrompt = fs.readFileSync(new URL('./settings.md', import.meta.url), 'utf8').trimEnd();
export const promptSha256 = createHash('sha256').update(settingsPrompt).digest('hex');
const virtualId = 'virtual:cindy-cloud-settings-guidance';
const resolvedId = '\0' + virtualId;
const helperPath = 'apps/desktop/src/main/host-settings/helper.ts';
const targets = {
  'apps/desktop/src/main/maker-host/runtime-configs.ts': [
    'appendCloudPluginOauthPrompt(composeHostPrompt(claudeSystemPrompt), getInstanceConfig() !== null)',
    'appendCloudPluginOauthPrompt(composeHostPrompt(codexSystemPrompt), getInstanceConfig() !== null)',
  ],
  'apps/desktop/src/main/maker-host/pi-host.ts': [
    'appendCloudPluginOauthPrompt(composePiSystemPrompt(hostSystemPrompt, piSystemPrompt), getInstanceConfig() !== null)',
  ],
};

export function appendCloudSettingsPrompt(existing, cloudInstance) {
  return cloudInstance ? `${existing}\n\n${settingsPrompt}` : existing;
}

// A cloud packaging overlay, never a write to the upstream client checkout.
export function transformCloudSource(code, relativePath) {
  if (relativePath === helperPath) {
    assert.ok(!code.includes(virtualId), 'Cloud result guidance must not be injected twice');
    const start = '  call: async (context, tool, args) => {';
    const end = '  },\n};';
    assert.equal(code.split(start).length, 2, 'Cloud settings helper entry changed');
    assert.equal(code.split(end).length, 2, 'Cloud settings helper exit changed');
    code = code.replace(start, '  call: (context, tool, args) => withCloudSettingsResult(tool, args, getInstanceConfig() !== null, async () => {').replace(end, '  }),\n};');
    return `import { withCloudSettingsResult } from '${virtualId}';\nimport { getInstanceConfig } from '../instance-runtime/config.js';\n${code}`;
  }
  const anchors = targets[relativePath];
  if (!anchors) return null;
  assert.ok(!code.includes(virtualId), 'Cloud guidance must not be injected twice');
  for (const anchor of anchors) {
    assert.equal(code.split(anchor).length, 2, `Cloud prompt integration changed: ${relativePath}`);
    code = code.replace(anchor, `appendCloudSettingsPrompt(${anchor}, getInstanceConfig() !== null)`);
  }
  return `import { appendCloudSettingsPrompt } from '${virtualId}';\n${code}`;
}

export function cloudSettingsGuidancePlugin({ sourceRoot, onTransform = () => {} }) {
  assert.ok(path.isAbsolute(sourceRoot), 'Explicit absolute client source root required');
  const seen = new Set();
  return {
    name: 'cindy-cloud-settings-guidance',
    enforce: 'pre',
    resolveId(id) { return id === virtualId ? resolvedId : null; },
    load(id) {
      if (id !== resolvedId) return null;
      return `const settingsPrompt = ${JSON.stringify(settingsPrompt)};\nexport ${appendCloudSettingsPrompt.toString()}\nexport ${cloudSettingsResultGuidance.toString()}\nexport ${withCloudSettingsResult.toString()}`;
    },
    transform(code, id) {
      const relativePath = path.relative(sourceRoot, id.split('?')[0]).split(path.sep).join('/');
      const transformed = transformCloudSource(code, relativePath);
      if (transformed === null) return null;
      seen.add(relativePath);
      onTransform({ relativePath, promptSha256 });
      return { code: transformed, map: null };
    },
    buildEnd(error) {
      if (error) return;
      // Install on the main entry only: a missing engine is a failed cloud build.
      assert.deepEqual([...seen].sort(), [...Object.keys(targets), helperPath].sort(), 'Cloud guidance did not reach all three engines');
    },
  };
}
