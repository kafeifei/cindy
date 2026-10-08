import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useUserPrompt } from '@/hooks/useUserPrompt';
import { USER_PROMPT_MAX_LENGTH } from '@/lib/userPrompt.constants';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';

export function UserPromptSection() {
  const { value, ready, unavailable, customized, revision, ownerKey, setValue, resetValue } = useUserPrompt();
  const { t } = useTranslation();

  const [draft, setDraft] = useState({ value, revision, ownerKey });
  const previousValue = useRef(value);
  const [saving, setSaving] = useState(false);

  // 同 owner 的外部修改不吞掉正在编辑的草稿；其旧 revision 会阻止覆盖。
  useEffect(() => {
    const previous = previousValue.current;
    previousValue.current = value;
    setDraft(current => current.ownerKey !== ownerKey || current.value === previous
      ? { value, revision, ownerKey } : current);
  }, [value, revision, ownerKey]);

  const length = draft.value.length;
  const overLimit = length > USER_PROMPT_MAX_LENGTH;
  const dirty = draft.value !== value;
  const conflicted = dirty && draft.revision !== revision;
  const canSave = ready && dirty && !overLimit && !saving && !conflicted;

  const handleSave = useCallback(async () => {
    if (!canSave || !draft.revision) return;
    setSaving(true);
    try {
      await setValue(draft.value, draft.revision);
      toast.success(t('settings.personalization.toast.saved'));
    } catch { toast.error(t('hostSettings.saveFailed')); }
    finally { setSaving(false); }
  }, [canSave, draft, setValue, t]);

  const handleReset = useCallback(async () => {
    if (!ready || !revision || saving) return;
    setSaving(true);
    try {
      await resetValue(revision);
      setDraft({ value: '', revision: null, ownerKey });
      toast.success(t('settings.personalization.toast.saved'));
    } catch { toast.error(t('hostSettings.saveFailed')); }
    finally { setSaving(false); }
  }, [ready, revision, saving, resetValue, ownerKey, t]);

  const counter = useMemo(
    () => `${length.toLocaleString()} / ${USER_PROMPT_MAX_LENGTH.toLocaleString()}`,
    [length],
  );

  return (
    <div className="flex flex-col gap-[14px]">
      <h2 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
        {t('settings.personalization.title')}
      </h2>

      <div
        className={cn(
          'flex flex-col gap-[14px] rounded-xl p-5',
          'bg-[var(--settings-theme-card-bg)]',
          'border border-[var(--settings-theme-card-border)]',
        )}
      >
        <div className="flex flex-col gap-1">
          <p
            className="text-13 font-medium text-[var(--settings-section-sublabel)]"
            style={{ letterSpacing: '0.12px' }}
          >
            {t('settings.personalization.subtitle')}
          </p>
          <p className="text-13 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('settings.personalization.description')}
          </p>
        </div>

        <textarea
          value={draft.ownerKey === ownerKey ? draft.value : ''}
          disabled={!ready || saving}
          onChange={(e) => setDraft(current => ({
            value: e.target.value,
            revision: current.value === value ? revision : current.revision,
            ownerKey,
          }))}
          placeholder={t('settings.personalization.placeholder')}
          aria-label={t('settings.personalization.ariaLabel')}
          rows={7}
          className={cn(
            'min-h-[160px] w-full resize-y rounded-xl',
            'p-4',
            'bg-[var(--settings-input-bg)]',
            'border border-[var(--settings-input-border)]',
            'text-13 leading-[1.6] text-[var(--settings-input-text)]',
            'placeholder:font-normal placeholder:text-[var(--settings-input-placeholder)] placeholder:opacity-45',
            'outline-none focus:border-[var(--settings-input-border-focus)]',
            'transition-colors',
          )}
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        />

        {(unavailable || conflicted) && (
          <p role="status" className="text-13 text-[var(--settings-section-desc)]">
            {t(unavailable ? 'hostSettings.loadFailed' : 'hostSettings.changed')}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              'text-12 tabular-nums',
              overLimit
                ? 'text-[var(--settings-error-text)]'
                : 'text-[var(--settings-source-meta)]',
            )}
            style={{ letterSpacing: '0.12px' }}
            aria-live="polite"
          >
            {counter}
            {overLimit ? t('settings.personalization.overLimit') : ''}
          </p>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleReset} disabled={!ready || !customized || saving || conflicted}>
              {t('hostSettings.reset')}
            </Button>
            <Button onClick={handleSave} disabled={!canSave} loading={saving}>
              {t('settings.personalization.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
