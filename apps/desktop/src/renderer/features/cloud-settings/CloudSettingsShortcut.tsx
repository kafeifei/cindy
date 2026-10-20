import { Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_RAIL_ICON_BUTTON_CLASS } from '@/components/sidebar/SidebarIconButton';
import { Tip } from '@/components/ui/tooltip';

/** A direct action on the named device, never a second instance picker. */
export function CloudSettingsShortcut({ deviceId, name }: { deviceId: string; name: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const label = t('cloudSettings.openFor', { name });
  return (
    <Tip text={label} side="right">
      <Link
        to={`/cloud-settings?${new URLSearchParams({ deviceId })}`}
        state={{ returnTo: location.pathname + location.search }}
        aria-label={label}
        className={`${SIDEBAR_RAIL_ICON_BUTTON_CLASS} shrink-0`}
        onClick={(event) => event.stopPropagation()}
      >
        <Settings2 size={14} aria-hidden />
      </Link>
    </Tip>
  );
}
