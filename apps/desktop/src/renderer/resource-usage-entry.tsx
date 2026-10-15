import { createRoot } from 'react-dom/client';
import { connectHostDesktopPreferences } from './state/hostDesktopPreferences';

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import 'harmonyos-sans-sc-webfont-splitted';

import '@/i18n';
import './themes/colors';
import './styles/globals.css';

import { TopLevelErrorBoundary } from './components/error/TopLevelErrorBoundary';
import { ResourceUsageWindowRoot } from './components/resource-usage/ResourceUsageWindowLayout';
import { applyFontSettings, getInitialFontSettings } from './hooks/useFontSettings';
import { getInitialThemeVariant } from './hooks/useTheme';
import { bootstrapLocalThemesSync } from './themes/local-themes';
import { themeService } from './themes/theme-service';
import { installHiddenAnimationGate } from './lib/hiddenAnimationGate';

document.documentElement.dataset.platform = window.electronAPI.platform;
installHiddenAnimationGate();
bootstrapLocalThemesSync();
themeService.applyTheme(getInitialThemeVariant().theme);
const disposeDesktopPreferences = connectHostDesktopPreferences({ readOnly: true });
import.meta.hot?.dispose(disposeDesktopPreferences);
applyFontSettings(getInitialFontSettings());

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <TopLevelErrorBoundary>
    <ResourceUsageWindowRoot />
  </TopLevelErrorBoundary>,
);
