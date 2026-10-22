/**
 * StreamFadeSection — Settings → 外观 下的「回复动效」开关。
 *
 * 控制流式输出时正文的淡入浮现动效(词段 / inline code 原子 + 列表圆点同帧
 * 浮现,见 rehypeStreamWordFade):开(默认)= 新内容淡入;关 = 文字直接显示。
 * 系统 reduced-motion 开启时动效无条件关闭,本开关不覆盖该行为。
 *
 * 存储走 useStreamFadePreference(Host profile 只存 override,恢复默认清除
 * override)。保存成功后更新正在流式的消息。
 * 卡片样式与 ChipMetricsSection 对齐(rounded 12 / Card bg / 1px Board)。
 */

import { useTranslation } from 'react-i18next';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useStreamFadePreference } from '@/hooks/useStreamFadePreference';
import { toast } from '@/lib/toast';
import { DefaultOverrideControls } from './DefaultOverrideControls';

export function StreamFadeSection() {
  const { t } = useTranslation();
  const { preference, setPreference, isCustomized, resetPreference } = useStreamFadePreference();
  const enabled = preference === 'on';

  return (
    <div className="flex flex-col gap-[14px]">
      <h3 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">
        {t('settings.streamFade.title')}
      </h3>

      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl px-4 py-4',
          'bg-[var(--settings-theme-card-bg)]',
          'border border-[var(--settings-theme-card-border)]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p
            className="text-13 font-medium text-[var(--settings-section-sublabel)]"
            style={{ letterSpacing: '0.12px' }}
          >
            {t('settings.streamFade.label')}
          </p>
          <p className="text-12 leading-[1.4] text-[var(--settings-section-sublabel)] opacity-70">
            {t('settings.streamFade.hint')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <DefaultOverrideControls isCustomized={isCustomized} onReset={async () => {
            if (await resetPreference()) toast.success(t('settings.defaults.restored'));
            else toast.error(t('hostSettings.saveFailed'));
          }} />
          <Switch
            checked={enabled}
            onCheckedChange={(next) => setPreference(next ? 'on' : 'off')}
            aria-label={t('settings.streamFade.toggleAria')}
          />
        </div>
      </div>
    </div>
  );
}
