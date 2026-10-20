import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import { useTranslation } from 'react-i18next';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { toast } from '@/lib/toast';
import { CloudInstancesPage } from './CloudInstancesPage';

/** Account-level discovery belongs inside local Settings; instance configuration
 * keeps its own explicit target and returns to this category. */
export function CloudInstancesSection() {
  const navigate = useNavigate();
  const { mode, dataOwnerId } = useAuth();
  const { t } = useTranslation();
  const devices = useDeviceLinkDeviceList();
  const owner = getDataOwnerGeneration();
  if (mode !== 'cloud') return null;
  return (
    <CloudInstancesPage
      key={JSON.stringify([dataOwnerId, owner.generation])}
      embedded
      api={window.electronAPI.cloudSettings}
      canOpenDesktop={(instance) =>
        !!devices?.some(
          (device) =>
            device.deviceId === instance.deviceId &&
            !device.isSelf &&
            device.online &&
            device.controlEnabled &&
            device.remoteControlEnabled,
        )
      }
      onOpenDesktop={(instance) => {
        void window.electronAPI
          .openRemoteDesktop({
            deviceId: instance.deviceId,
            name:
              instance.name ??
              t('cloudSettings.onboarding.defaultName', { number: instance.nameSequence }),
          })
          .catch(() => toast.error(t('remoteDesktop.connectionError')));
      }}
      onOpen={(deviceId, section) =>
        navigate(
          `/cloud-settings?${new URLSearchParams({ deviceId, ...(section ? { section } : {}) })}`,
          {
            state: { returnTo: '/settings?tab=cloud-instances' },
          },
        )
      }
    />
  );
}
