import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';

const service = 'apps/desktop/src/main/updateService.ts';
const preload = 'apps/desktop/src/preload/preload.ts';
const notice = 'apps/desktop/src/renderer/hooks/useUpdateNotice.ts';
const about = 'apps/desktop/src/renderer/components/settings/AboutSection.tsx';
const aboutSearch = 'apps/desktop/src/renderer/components/settings/AboutSection.settings-search.ts';
export const targets = [service, preload, notice, about, aboutSearch];
const hint = `(window.electronAPI as typeof window.electronAPI & { cloudUpdatesManaged?: boolean }).cloudUpdatesManaged === true`;

function once(code, before, after) {
  assert.equal(code.split(before).length, 2, `Cloud update integration changed: ${before.slice(0, 100)}`);
  return code.replace(before, after);
}

// Only the cloud image build applies this overlay. Main-process decisions use
// the validated instance configuration; the renderer flag is presentation only.
export function transformCloudUpdateSource(code, relativePath) {
  if (!targets.includes(relativePath)) return null;
  assert.ok(!code.includes('cloudUpdatesManaged'), 'Cloud update overlay must not be injected twice');
  if (relativePath === service) {
    code = `import { getInstanceConfig } from './instance-runtime/config.js';\nfunction cloudUpdatesManaged() { return process.platform === 'linux' && getInstanceConfig() !== null; }\n${code}`;
    // Preserve all ordinary-desktop paths. The existing personal-build guards
    // already fence staging, old patches, installer execution and polling.
    assert.equal(code.split('isCindyPersonalRuntime()').length, 9, 'Cloud update guards changed');
    code = code.replaceAll('isCindyPersonalRuntime()', '(isCindyPersonalRuntime() || cloudUpdatesManaged())');
    for (const name of ['getAutoRelaunchBlockReasonForCurrentState', 'getStartupRelaunchBlockReason']) {
      const anchor = `async function ${name}(): Promise<AutoRelaunchBlockReason | null> {`;
      code = once(code, anchor, `${anchor}\n  if (cloudUpdatesManaged()) return 'disabled';`);
    }
    code = once(code, "    const available = await probeBetaManifest();", "    if (cloudUpdatesManaged()) return { available: false };\n    const available = await probeBetaManifest();");
    code = once(code, "    log.info('relaunch requested for update channel change');", "    if (cloudUpdatesManaged()) return;\n    log.info('relaunch requested for update channel change');");
    code = once(code, "  if (!supportsBetaUpdateChannel(process.platform, process.arch)) return false;", "  if (cloudUpdatesManaged()) return false;\n  if (!supportsBetaUpdateChannel(process.platform, process.arch)) return false;");
  } else if (relativePath === preload) {
    // Reuse the main-window argument already emitted by runtime-window-controls.
    code = once(code, '  platform: process.platform,', `  platform: process.platform,\n  cloudUpdatesManaged: process.platform === 'linux' && process.argv.includes('--cindy-cloud-main-window'),`);
  } else if (relativePath === notice) {
    code = once(code, '  useEffect(() => {\n    const appVersion = window.electronAPI.appVersion;', `  useEffect(() => {\n    if (${hint}) return;\n    const appVersion = window.electronAPI.appVersion;`);
  } else if (relativePath === about) {
    code = once(code, '        <AutoUpdateToggleRow />\n        <Divider />', `        {!(${hint}) && <><AutoUpdateToggleRow /><Divider /></>}`);
  } else if (relativePath === aboutSearch) {
    // The catalog is static and independent of the rendered row. Remove its
    // declaration in cloud builds so search and deep links agree with the UI.
    code = once(code,
      "    { id: 'settings.about.autoUpdateLabel', fallbackTargetId: 'settings-panel-about', tab: 'about', targetId: 'settings-search-settings-about-autoUpdateLabel', titleKey: 'settings.about.autoUpdateLabel', sectionKey: 'settings.tabs.about' },",
      '    // cloudUpdatesManaged: desktop auto-update is absent from the cloud catalog.');
  }
  return code;
}

export function cloudManagedUpdatesPlugin({ sourceRoot, onTransform = () => {} }) {
  assert.ok(path.isAbsolute(sourceRoot));
  return {
    name: 'cindy-cloud-managed-updates', enforce: 'pre',
    transform(code, id) {
      const relativePath = path.relative(sourceRoot, id).split(path.sep).join('/');
      const result = transformCloudUpdateSource(code, relativePath);
      if (result === null) return null;
      onTransform({ relativePath, beforeSha256: createHash('sha256').update(code).digest('hex'), afterSha256: createHash('sha256').update(result).digest('hex') });
      return { code: result, map: null };
    },
  };
}
