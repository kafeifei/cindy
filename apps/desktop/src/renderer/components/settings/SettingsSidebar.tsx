import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tip } from '@/components/ui/tooltip';

/** The same settings frame for local and cloud controllers. */
export function SettingsSidebar({
  width = 260,
  onBack,
  disabled = false,
  children,
}: {
  width?: number;
  onBack(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <aside
      className="flex h-full min-h-0 shrink-0 flex-col gap-2 overflow-y-auto pl-6 pr-4 pt-7"
      style={{ width }}
      aria-label={t('settings.title')}
    >
      <div className="flex items-center gap-2.5 px-3 pb-[18px]">
        <Tip text={t('settings.back')} side="bottom">
          <button
            type="button"
            onClick={onBack}
            disabled={disabled}
            aria-label={t('settings.back')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--settings-back-icon)] transition-[color,background-color,transform] duration-150 hover:bg-titlebar-button-hover hover:text-[var(--settings-back-text)] active:scale-[0.98]"
          >
            <ArrowLeft size={20} />
          </button>
        </Tip>
        <h1 className="text-24 font-medium leading-[1.1] text-[var(--settings-back-text)]">
          {t('settings.title')}
        </h1>
      </div>
      {children}
    </aside>
  );
}
