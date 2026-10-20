import type { SettingsSearchModule } from './settingsSearchTypes';

export default {
  id: 'cloud-instances',
  order: 3,
  entries: [
    {
      id: 'cloudInstances',
      tab: 'cloud-instances',
      targetId: 'settings-panel-cloud-instances',
      titleKey: 'cloudSettings.instance.title',
      sectionKey: 'cloudSettings.instance.title',
      descriptionKey: 'cloudSettings.onboarding.subtitle',
      keywordKeys: [
        'cloudSettings.onboarding.claim',
        'cloudSettings.onboarding.initialize',
        'cloudSettings.instance.autoUpdate',
        'cloudSettings.instance.schedule',
      ],
      isVisible: ({ mode }) => mode === 'cloud',
    },
  ],
} satisfies SettingsSearchModule;
