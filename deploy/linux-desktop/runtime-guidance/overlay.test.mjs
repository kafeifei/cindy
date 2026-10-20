import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { appendCloudSettingsPrompt, cloudSettingsGuidancePlugin, transformCloudSource, settingsPrompt } from './overlay.mjs';

const sourceRoot = process.env.CINDY_TEST_CLIENT_SOURCE;
assert.ok(sourceRoot && path.isAbsolute(sourceRoot), 'Set CINDY_TEST_CLIENT_SOURCE to the client checkout');
const require = createRequire(path.join(sourceRoot, 'package.json'));
const ts = require('typescript');
const read = n => fs.readFileSync(path.join(sourceRoot, 'apps/desktop/src/main', n), 'utf8');
const compose = (...parts) => parts.map(x => x.trim()).filter(Boolean).join('\n\n');
const prefix = '  unchanged cloud OAuth prefix\n';
const files = ['runtime-configs.ts', 'pi-host.ts'];
let engines = 0;
for (const file of files) {
  const relative = `apps/desktop/src/main/maker-host/${file}`;
  const original = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
  const code = transformCloudSource(original, relative);
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const getters = [];
  function visit(node) { if (ts.isGetAccessor(node) && node.name.getText(ast) === 'systemPrompt') getters.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  assert.equal(getters.length, file === files[0] ? 2 : 1);
  for (const getter of getters) {
    const engine = getter.body.getText(ast).includes('claudeSystemPrompt') ? 'Claude' : getter.body.getText(ast).includes('codexSystemPrompt') ? 'Codex' : 'Pi';
    engines++;
    const body = getter.body.getText(ast).slice(1, -1);
    const host = read('maker-host/host-system-prompt.md');
    const harness = read(`maker-host/${engine === 'Claude' ? 'claude' : engine.toLowerCase()}-system-prompt.md`);
    const originalPrompt = engine === 'Pi' ? compose(host, harness) : compose(host, read('maker-host/skill-source-precedence-prompt.md'), harness);
    const evaluate = cloud => new Function('appendCloudSettingsPrompt', 'appendCloudPluginOauthPrompt', 'getInstanceConfig', 'composeHostPrompt', 'composePiSystemPrompt', 'hostSystemPrompt', 'claudeSystemPrompt', 'codexSystemPrompt', 'piSystemPrompt', body)(appendCloudSettingsPrompt, (s,c) => c ? s+'\n\n'+prefix : s, () => cloud ? {} : null, p => compose(host, read('maker-host/skill-source-precedence-prompt.md'), p), compose, host, harness, harness, harness);
    test(`${engine}: actual transformed getter preserves non-cloud bytes`, () => assert.equal(evaluate(false), originalPrompt));
    test(`${engine}: actual transformed getter appends one stable cloud suffix`, () => {
      assert.equal(evaluate(true), `${originalPrompt}\n\n${prefix}\n\n${settingsPrompt}`);
      assert.equal(evaluate(true), evaluate(true));
      assert.equal(evaluate(true).split(settingsPrompt).length, 2);
    });
  }
  test(`${file}: source drift or duplicate injection rejects build`, () => {
    assert.throws(() => transformCloudSource(code, relative));
    assert.throws(() => transformCloudSource(original.replaceAll('getInstanceConfig()', 'changedInstanceConfig()'), relative));
  });
}
assert.equal(engines,3);
test('arbitrary prefix bytes are unchanged', () => {
  assert.equal(appendCloudSettingsPrompt(prefix,false),prefix);
  assert.equal(appendCloudSettingsPrompt(prefix,true),prefix+'\n\n'+settingsPrompt);
});
test('unrelated client sources are not transformed', () => assert.equal(transformCloudSource('unchanged','apps/desktop/src/renderer/main-entry.tsx'),null));
test('cloud build rejects an omitted engine and resolves the exact virtual module', () => {
  const plugin = cloudSettingsGuidancePlugin({sourceRoot});
  assert.throws(() => plugin.buildEnd());
  assert.equal(plugin.resolveId('unrelated'),null);
  const id=plugin.resolveId('virtual:cindy-cloud-settings-guidance');
  assert.ok(plugin.load(id).includes(JSON.stringify(settingsPrompt)));
  for(const file of files){const relative=`apps/desktop/src/main/maker-host/${file}`;plugin.transform(fs.readFileSync(path.join(sourceRoot,relative),'utf8'),path.join(sourceRoot,relative));}
  const helper='apps/desktop/src/main/host-settings/helper.ts';
  assert.throws(() => plugin.buildEnd());
  plugin.transform(fs.readFileSync(path.join(sourceRoot,helper),'utf8'),path.join(sourceRoot,helper));
  plugin.buildEnd();
});
