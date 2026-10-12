/**
 * MessageNavRailCell — TipsSection 内的 "显示提问导航条" cell row。
 * Host profile 偏好(默认开启),成功提交后更新 Renderer。
 * 行内形态与 SilentEncryptedRetryCell 对齐;恢复默认走 DefaultOverrideControls
 * (语义 = 清 override 跟随版本默认,见 useMessageNavRailPreference)。
 */

import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { useMessageNavRailPreference } from '@/hooks/useMessageNavRailPreference';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { DefaultOverrideControls } from './DefaultOverrideControls';

export function MessageNavRailCell() {
  const { t } = useTranslation();
  const { enabled, isCustomized, setEnabled, resetPreference } = useMessageNavRailPreference();

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-[14px]">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            'bg-[var(--settings-input-bg)]',
          )}
        >
          <ListOrdered size={18} className="text-[var(--settings-section-title)]" />
        </div>
        <div className="flex flex-col gap-[8px]">
          <p className="text-14 font-medium leading-none text-[var(--settings-section-title)]">
            {t('settings.messageNavRail.cell.label')}
          </p>
          <p className="text-12 leading-[1.4] text-[var(--settings-section-desc)]">
            {t('settings.messageNavRail.cell.description')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DefaultOverrideControls isCustomized={isCustomized} onReset={async () => {
          if (!await resetPreference()) toast.error(t('hostSettings.saveFailed'));
        }} />
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t('settings.messageNavRail.toggleAria')}
        />
      </div>
    </div>
  );
}
