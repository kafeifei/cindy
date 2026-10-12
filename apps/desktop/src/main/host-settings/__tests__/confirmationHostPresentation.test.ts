import { afterEach, expect, it } from 'vitest';
import { setMainLocale } from '../../i18n.js';
import { buildHostSettingsConfirmationPreview } from '../confirmationHostPresentation.js';

afterEach(() => setMainLocale('en'));

it.each([
  ['en', 'Use default (Automatic)'],
  ['zh-CN', '跟随默认（自动选择）'],
  ['zh-TW', '跟隨預設（自動選擇）'],
  ['ja', 'デフォルトを使用（自動選択）'],
  ['ko', '기본값 사용 (자동 선택)'],
] as const)('renders a reset card using the real %s main-process translator', (locale, expected) => {
  setMainLocale(locale);
  const preview = buildHostSettingsConfirmationPreview({ domain: 'terminal', clear: ['defaultShellPref'],
    before: { defaultShellPref: 'bash' }, defaults: { defaultShellPref: 'auto' } });
  expect(preview.changes).toHaveLength(1);
  expect(preview.changes[0]?.value).toBe(expected);
  expect(JSON.stringify(preview)).not.toContain('{{value}}');
});

it('preserves literal placeholders in the user-provided new instructions', () => {
  const preview = buildHostSettingsConfirmationPreview({ domain: 'personalization',
    set: { userPrompt: 'Keep {{value}} as literal text' }, before: { isCustomized: false } });
  expect(preview.changes[0]?.value).toBe('Keep {{value}} as literal text');
});
