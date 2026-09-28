import { useCallback, useEffect, useRef, useState } from 'react';

import {
  normalizeAgentIslandDisplayTarget,
  normalizeAgentIslandSoundSettings,
  isAgentIslandSupportedPlatform,
  type AgentIslandDisplayOption,
  type AgentIslandDisplayTarget,
  type AgentIslandMascotSkin,
  type AgentIslandSoundChoice,
  type AgentIslandSoundEvent,
  type AgentIslandSoundSettings,
} from '../../shared/agentIsland';
import { createLogger } from '@/lib/logger';
import { getDesktopPreference, setDesktopPreference, updateDesktopPreference, clearDesktopPreference, isDesktopPreferenceCustomized, useDesktopPreference, useDesktopPreferenceCustomized } from '../state/hostDesktopPreferences';

const log = createLogger('AgentIslandSettings');

export function isAgentIslandSupported(): boolean {
  return isAgentIslandSupportedPlatform(window.electronAPI?.platform, window.electronAPI?.osRelease);
}

/** Host profile 是持久化正本；自定义路径和显示器身份不可直接进入 wire 快照。 */
export function getAgentIslandEnabled(): boolean { return getDesktopPreference('agentIslandEnabled'); }
export function getAgentIslandSoundSettings(): AgentIslandSoundSettings { return getDesktopPreference('agentIslandSoundSettings'); }
export function isAgentIslandSoundSettingsCustomized(): boolean { return isDesktopPreferenceCustomized('agentIslandSoundSettings'); }
export function getAgentIslandMascotSkin(): AgentIslandMascotSkin { return getDesktopPreference('agentIslandMascotSkin'); }
export function getAgentIslandDisplayTarget(): AgentIslandDisplayTarget { return getDesktopPreference('agentIslandDisplayTarget'); }

function getAgentIslandSetEnabledApi():
  | ((enabled: boolean) => Promise<{ ok: true }>)
  | null {
  const setEnabled = window.electronAPI?.agentIsland?.setEnabled;
  return typeof setEnabled === 'function' ? setEnabled : null;
}

function getAgentIslandSetSoundSettingsApi():
  | ((settings: AgentIslandSoundSettings) => Promise<{ ok: true }>)
  | null {
  const setSoundSettings = window.electronAPI?.agentIsland?.setSoundSettings;
  return typeof setSoundSettings === 'function' ? setSoundSettings : null;
}

function getAgentIslandSetMascotSkinApi():
  | ((skin: AgentIslandMascotSkin) => Promise<{ ok: true }>)
  | null {
  const setMascotSkin = window.electronAPI?.agentIsland?.setMascotSkin;
  return typeof setMascotSkin === 'function' ? setMascotSkin : null;
}

function getAgentIslandSetDisplayTargetApi():
  | ((target: AgentIslandDisplayTarget) => Promise<{ ok: true }>)
  | null {
  const setDisplayTarget = window.electronAPI?.agentIsland?.setDisplayTarget;
  return typeof setDisplayTarget === 'function' ? setDisplayTarget : null;
}

function getAgentIslandGetDisplayOptionsApi():
  | (() => Promise<{
      ok: true;
      options: AgentIslandDisplayOption[];
      target?: AgentIslandDisplayTarget;
    }>)
  | null {
  const getDisplayOptions = window.electronAPI?.agentIsland?.getDisplayOptions;
  return typeof getDisplayOptions === 'function' ? getDisplayOptions : null;
}

async function applyAgentIslandEnabledToMain(next: boolean): Promise<boolean> {
  if (!isAgentIslandSupported()) return false;
  const setEnabled = getAgentIslandSetEnabledApi();
  if (!setEnabled) {
    log.warn('agent island setEnabled unavailable; restart desktop to load the latest preload');
    return false;
  }
  try {
    await setEnabled(next);
    return true;
  } catch (err) {
    log.warn('agent island setEnabled failed', err);
    return false;
  }
}

async function applyAgentIslandSoundSettingsToMain(settings: AgentIslandSoundSettings): Promise<boolean> {
  if (!isAgentIslandSupported()) return false;
  const setSoundSettings = getAgentIslandSetSoundSettingsApi();
  if (!setSoundSettings) {
    log.warn('agent island setSoundSettings unavailable; restart desktop to load the latest preload');
    return false;
  }
  try {
    await setSoundSettings(settings);
    return true;
  } catch (err) {
    log.warn('agent island setSoundSettings failed', err);
    return false;
  }
}

async function applyAgentIslandMascotSkinToMain(skin: AgentIslandMascotSkin): Promise<boolean> {
  if (!isAgentIslandSupported()) return false;
  const setMascotSkin = getAgentIslandSetMascotSkinApi();
  if (!setMascotSkin) {
    log.warn('agent island setMascotSkin unavailable; restart desktop to load the latest preload');
    return false;
  }
  try {
    await setMascotSkin(skin);
    return true;
  } catch (err) {
    log.warn('agent island setMascotSkin failed', err);
    return false;
  }
}

async function applyAgentIslandDisplayTargetToMain(target: AgentIslandDisplayTarget): Promise<boolean> {
  if (!isAgentIslandSupported()) return false;
  const setDisplayTarget = getAgentIslandSetDisplayTargetApi();
  if (!setDisplayTarget) {
    log.warn('agent island setDisplayTarget unavailable; restart desktop to load the latest preload');
    return false;
  }
  try {
    await setDisplayTarget(target);
    return true;
  } catch (err) {
    log.warn('agent island setDisplayTarget failed', err);
    return false;
  }
}

export async function loadAgentIslandDisplayOptions(): Promise<AgentIslandDisplayOption[]> {
  if (!isAgentIslandSupported()) return [];
  const getDisplayOptions = getAgentIslandGetDisplayOptionsApi();
  if (!getDisplayOptions) {
    log.warn('agent island getDisplayOptions unavailable; restart desktop to load the latest preload');
    return [];
  }
  try {
    const result = await getDisplayOptions();
    // OS 显示器解析只是运行态解释，不是用户 override，也不能充当迁移输入。
    return normalizeAgentIslandDisplayOptions(result.options);
  } catch (err) {
    log.warn('agent island getDisplayOptions failed', err);
    return [];
  }
}

export function syncAgentIslandEnabledToMain(): void {
  if (!isAgentIslandSupported()) return;
  void (async () => {
    await Promise.all([
      applyAgentIslandSoundSettingsToMain(getAgentIslandSoundSettings()),
      applyAgentIslandMascotSkinToMain(getAgentIslandMascotSkin()),
      applyAgentIslandDisplayTargetToMain(getAgentIslandDisplayTarget()),
    ]);
    await applyAgentIslandEnabledToMain(getAgentIslandEnabled());
  })();
}

export function useResyncAgentIslandSettingsAfterLogin(isAuthenticated: boolean): void {
  const previousAuthRef = useRef<boolean | null>(null);

  useEffect(() => {
    const previous = previousAuthRef.current;
    previousAuthRef.current = isAuthenticated;
    if (isAuthenticated && previous !== true) {
      syncAgentIslandEnabledToMain();
    }
  }, [isAuthenticated]);
}

export async function setAgentIslandEnabled(next: boolean): Promise<boolean> {
  if (!await setDesktopPreference('agentIslandEnabled', next)) return false;
  await applyAgentIslandEnabledToMain(next);
  return true;
}
export async function setAgentIslandSoundSettings(next: AgentIslandSoundSettings): Promise<boolean> {
  const settings = normalizeAgentIslandSoundSettings(next);
  if (!await setDesktopPreference('agentIslandSoundSettings', settings)) return false;
  await applyAgentIslandSoundSettingsToMain(settings);
  return true;
}
export async function resetAgentIslandSoundSettings(): Promise<boolean> {
  if (!await clearDesktopPreference('agentIslandSoundSettings')) return false;
  await applyAgentIslandSoundSettingsToMain(getAgentIslandSoundSettings());
  return true;
}
export async function setAgentIslandMascotSkin(next: AgentIslandMascotSkin): Promise<boolean> {
  if (!await setDesktopPreference('agentIslandMascotSkin', next)) return false;
  await applyAgentIslandMascotSkinToMain(next);
  return true;
}
export async function setAgentIslandDisplayTarget(next: AgentIslandDisplayTarget): Promise<boolean> {
  const target = normalizeAgentIslandDisplayTarget(next);
  if (!await setDesktopPreference('agentIslandDisplayTarget', target)) return false;
  await applyAgentIslandDisplayTargetToMain(target);
  return true;
}

async function updateAgentIslandSounds(update: (current: AgentIslandSoundSettings) => AgentIslandSoundSettings): Promise<void> {
  if (await updateDesktopPreference('agentIslandSoundSettings', update)) await applyAgentIslandSoundSettingsToMain(getAgentIslandSoundSettings());
}

export function toggleAgentIslandSoundEnabled(): void {
  void updateAgentIslandSounds(current => ({ ...current, enabled: !current.enabled }));
}

export function previewAgentIslandSound(sound: AgentIslandSoundChoice): void {
  if (!isAgentIslandSupported() || (sound.type === 'builtin' && sound.id === 'none')) return;
  void window.electronAPI?.agentIsland?.previewSound?.(sound).catch((err) => {
    log.warn('agent island previewSound failed', err);
  });
}

export function useAgentIslandSettings(): {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  soundSettings: AgentIslandSoundSettings;
  soundCustomized: boolean;
  mascotSkin: AgentIslandMascotSkin;
  displayTarget: AgentIslandDisplayTarget;
  displayOptions: AgentIslandDisplayOption[];
  setSoundEnabled: (next: boolean) => void;
  setSound: (event: AgentIslandSoundEvent, sound: AgentIslandSoundChoice) => void;
  resetSoundSettings: () => Promise<boolean>;
  setMascotSkin: (skin: AgentIslandMascotSkin) => void;
  setDisplayTarget: (target: AgentIslandDisplayTarget) => void;
  previewSound: (sound: AgentIslandSoundChoice) => void;
  selectSoundFile: () => Promise<AgentIslandSoundChoice | null>;
  supported: boolean;
} {
  const enabled = useDesktopPreference('agentIslandEnabled');
  const soundSettings = useDesktopPreference('agentIslandSoundSettings');
  const soundCustomized = useDesktopPreferenceCustomized('agentIslandSoundSettings');
  const mascotSkin = useDesktopPreference('agentIslandMascotSkin');
  const displayTarget = useDesktopPreference('agentIslandDisplayTarget');
  const [displayOptions, setDisplayOptionsState] = useState<AgentIslandDisplayOption[]>([]);
  const supported = isAgentIslandSupported();

  const setEnabled = useCallback((next: boolean) => {
    void setAgentIslandEnabled(next);
  }, []);

  const setSoundEnabled = useCallback((next: boolean) => {
    void updateAgentIslandSounds(current => ({ ...current, enabled: next }));
  }, []);

  const setSound = useCallback((event: AgentIslandSoundEvent, sound: AgentIslandSoundChoice) => {
    void updateAgentIslandSounds(current => ({
      ...current,
      sounds: {
        ...current.sounds,
        [event]: sound,
      },
    }));
  }, []);

  const resetSoundSettings = useCallback(async () => {
    return resetAgentIslandSoundSettings();
  }, []);

  const setMascotSkin = useCallback((skin: AgentIslandMascotSkin) => {
    void setAgentIslandMascotSkin(skin);
  }, []);

  const setDisplayTarget = useCallback((target: AgentIslandDisplayTarget) => {
    let nextTarget = target;
    if (target.mode === 'display') {
      const option = displayOptions.find((item) => item.id === target.displayId);
      if (option) {
        nextTarget = {
          ...target,
          displayName: option.name || undefined,
          displayIndex: option.index,
          displayInternal: option.internal,
          displayBounds: { ...option.bounds },
        };
      }
    }
    void setAgentIslandDisplayTarget(nextTarget);
  }, [displayOptions]);

  const previewSound = useCallback((sound: AgentIslandSoundChoice) => {
    previewAgentIslandSound(sound);
  }, []);

  const selectSoundFile = useCallback(async (): Promise<AgentIslandSoundChoice | null> => {
    if (!isAgentIslandSupported()) return null;
    const result = await window.electronAPI?.agentIsland?.selectSoundFile?.();
    if (!result?.path) return null;
    return {
      type: 'custom',
      path: result.path,
      name: result.name ?? agentIslandSoundFileName(result.path),
    };
  }, []);

  useEffect(() => {
    syncAgentIslandEnabledToMain();
  }, [enabled, soundSettings, mascotSkin, displayTarget]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const refreshOptions = () => {
      void loadAgentIslandDisplayOptions().then((options) => {
        if (!cancelled) setDisplayOptionsState(options);
      });
    };
    refreshOptions();
    window.addEventListener('focus', refreshOptions);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOptions);
    };
  }, [supported]);

  return {
    enabled,
    setEnabled,
    soundSettings,
    soundCustomized,
    mascotSkin,
    displayTarget,
    displayOptions,
    setSoundEnabled,
    setSound,
    resetSoundSettings,
    setMascotSkin,
    setDisplayTarget,
    previewSound,
    selectSoundFile,
    supported,
  };
}

function normalizeAgentIslandDisplayOptions(raw: unknown): AgentIslandDisplayOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AgentIslandDisplayOption[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const bounds = record.bounds;
    if (
      typeof record.id !== 'number'
      || !Number.isFinite(record.id)
      || typeof record.index !== 'number'
      || !Number.isFinite(record.index)
      || typeof bounds !== 'object'
      || bounds === null
    ) {
      return [];
    }
    const boundsRecord = bounds as Record<string, unknown>;
    if (
      typeof boundsRecord.x !== 'number'
      || typeof boundsRecord.y !== 'number'
      || typeof boundsRecord.width !== 'number'
      || typeof boundsRecord.height !== 'number'
    ) {
      return [];
    }
    return [{
      id: record.id,
      index: record.index,
      name: typeof record.name === 'string' ? record.name.trim() : '',
      isPrimary: record.isPrimary === true,
      internal: record.internal === true,
      bounds: {
        x: boundsRecord.x,
        y: boundsRecord.y,
        width: boundsRecord.width,
        height: boundsRecord.height,
      },
    }];
  });
}

function agentIslandSoundFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? filePath;
}
