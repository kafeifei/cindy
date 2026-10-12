import { describe, expect, it } from 'vitest';
import { parseSettingsConfirmationPreview } from '@cindy/maker-shared/interaction';
import en from '../../../renderer/i18n/locales/en/common.json';
import zhCN from '../../../renderer/i18n/locales/zh-CN/common.json';
import zhTW from '../../../renderer/i18n/locales/zh-TW/common.json';
import ja from '../../../renderer/i18n/locales/ja/common.json';
import ko from '../../../renderer/i18n/locales/ko/common.json';
import { buildSettingsConfirmationPreview } from '../confirmationPresentation.js';
import { additionalSettingsPresentation } from '../../../shared/settingsEditablePresentation.js';

function translate(bundle: unknown) {
  return (key: string, values?: Record<string, string | number>) => {
    let value: unknown = bundle;
    for (const segment of key.split('.')) value = (value as Record<string, unknown>)[segment];
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''));
  };
}
const t = translate(zhCN);

describe('settings confirmation presentation', () => {
  it.each([en, zhCN, zhTW, ja, ko])('describes plugin and provider table edits with human labels in every language', bundle => {
    const route = { harness: 'pi', providerId: 'provider-fixture', modelId: 'model-fixture' };
    const preview = buildSettingsConfirmationPreview({ domain: 'pluginErrand', set: { routes: [{ ghostId: 'plugin-fixture', ...route, effort: 'high', fastMode: null }] },
      choices: { routes: [{ value: { ghostId: 'plugin-fixture' }, label: 'Fixture Plugin' }], modelRoutes: [{ value: route, label: 'Fixture Model' }] }, before: { routes: [] } }, translate(bundle));
    expect(preview.changes[0]?.value).toContain('Fixture Plugin');
    expect(preview.changes[0]?.value).toContain('Fixture Model');
    expect(preview.changes[0]?.value).not.toMatch(/undefined|\[object Object\]|plugin-fixture|provider-fixture/);
    expect(parseSettingsConfirmationPreview({ preview })).toEqual(preview);
    const name = buildSettingsConfirmationPreview({ domain: 'providerNames', set: { entries: [{ providerId: 'provider-fixture', name: 'My Provider' }] }, choices: { entries: [{ value: { providerId: 'provider-fixture' }, label: 'Fixture Provider' }] } }, translate(bundle));
    expect(name.changes[0]?.value).toContain('Fixture Provider');
    expect(name.changes[0]?.value).toContain('My Provider');
  });
  it.each([en, zhCN, zhTW, ja, ko])('localizes every expanded settings card without raw protocol values', bundle => {
    for (const [domain, description] of Object.entries(additionalSettingsPresentation)) {
      const set = Object.fromEntries(Object.entries(description.fields).map(([field, value]) => [field,
        value.options ? value.options[0]![0] : value.number ? value.number[0] : value.select === 'one' ? null : value.select === 'route' ? { providerId: 'provider-fixture', modelId: 'model-fixture', effort: 'high' } : value.select ? [] : false]));
      const preview = buildSettingsConfirmationPreview({ domain, set, before: set }, translate(bundle));
      expect(parseSettingsConfirmationPreview({ preview })).toEqual(preview);
      expect(preview.changes).toHaveLength(Object.keys(set).length);
      expect(JSON.stringify(preview)).not.toMatch(/hostSettings\.|settings\.|operationId|expectedRevision/);
    }
  });
  it('shows only the captured field change with its real previous value and application boundary', () => {
    expect(buildSettingsConfirmationPreview({ domain: 'databaseWarning', set: { thresholdGiB: 5 }, clear: [],
      before: { thresholdGiB: 10, disabled: false }, defaults: { thresholdGiB: 10, disabled: false },
    }, t)).toEqual({ version: 1, title: '修改设置', description: '仅影响运行此任务的 Cindy，保存后立即生效。',
      confirmLabel: '保存修改', cancelLabel: '取消',
      changes: [{ label: '数据库提醒阈值', previous: '10 GiB', value: '5 GiB' }],
    });
  });
  it('distinguishes following defaults from explicitly saving the same value and handles inverted switches', () => {
    const input = { domain: 'databaseWarning', before: { thresholdGiB: 10, disabled: false }, defaults: { thresholdGiB: 10, disabled: false } };
    const reset = buildSettingsConfirmationPreview({ ...input, clear: ['thresholdGiB'], set: { disabled: true } }, t);
    expect(reset.changes).toEqual([
      { label: '数据库提醒', previous: '开启', value: '关闭' },
      { label: '数据库提醒阈值', previous: '10 GiB', value: '跟随默认（10 GiB）' },
    ]);
    expect(buildSettingsConfirmationPreview({ ...input, set: { thresholdGiB: 10 } }, t).changes[0]?.value).toBe('10 GiB');
  });
  it('keeps long new instructions complete without disclosing the old prompt', () => {
    const value = `${'new instruction '.repeat(300)}END`;
    const preview = buildSettingsConfirmationPreview({ domain: 'personalization', set: { userPrompt: value }, before: { isCustomized: true } }, t);
    expect(preview.changes).toEqual([{ label: '个性化指令', previous: '已设置', value }]);
    expect(parseSettingsConfirmationPreview({ preview })).toEqual(preview);
    expect(buildSettingsConfirmationPreview({ domain: 'personalization', clear: ['userPrompt'], before: { isCustomized: true } }, t).changes[0]?.value).toBe('跟随默认（空白）');
  });
  it('uses a read action for separate prompt disclosure and rejects unsupported fields', () => {
    const preview = buildSettingsConfirmationPreview({ domain: 'personalization', action: 'read_user_prompt' }, t);
    expect(preview.confirmLabel).toBe('允许查看');
    expect(preview.changes).toEqual([]);
    expect(() => buildSettingsConfirmationPreview({ domain: 'appearance', set: { token: 'untrusted' } }, t)).toThrow('INVALID_PARAMS');
  });
  it.each([en, zhCN, zhTW, ja, ko])('has complete localized copy for every supported field', bundle => {
    const inputs = [
      { domain: 'newTaskDefaults', set: { harness: 'pi', providerId: null, modelId: 'example-model', effort: 'high', fast: false, thinking: true, worktree: true, planMode: false } },
      { domain: 'appearance', set: { uiFamily: 'Inter', codeFamily: '', uiSize: 14, codeSize: 13, windowZoom: 1.1 } },
      { domain: 'databaseWarning', set: { disabled: false, thresholdGiB: 5 } },
      { domain: 'personalization', set: { userPrompt: 'Example instructions' } },
    ];
    for (const input of inputs) {
      const preview = buildSettingsConfirmationPreview(input, translate(bundle));
      expect(parseSettingsConfirmationPreview({ preview })).toEqual(preview);
      expect(JSON.stringify(preview)).not.toContain('hostSettings.card.');
    }
    for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const) {
      const preview = buildSettingsConfirmationPreview({ domain: 'newTaskDefaults', set: { effort }, before: { effort: 'medium' } }, translate(bundle));
      expect(preview.changes).toEqual([{ label: bundle.hostSettings.card.fields.effort,
        previous: bundle.effortLevels.medium, value: bundle.effortLevels[effort] }]);
    }
    const reset = buildSettingsConfirmationPreview({ domain: 'newTaskDefaults', clear: ['effort'],
      before: { effort: 'high' }, defaults: { effort: 'low' } }, translate(bundle));
    expect(reset.changes[0]?.previous).toBe(bundle.effortLevels.high);
    expect(reset.changes[0]?.value).toContain(bundle.effortLevels.low);
  });
});
