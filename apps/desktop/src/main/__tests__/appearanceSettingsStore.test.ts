import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceSettings } from '../../shared/appearanceSettings.js';
import { isValidAppearanceSetting, normalizeAppearanceSettings } from '../../shared/appearanceSettings.js';
import { normalizeHostSettingsChange } from '../../shared/hostSettings.js';

const host = vi.hoisted(() => ({ root: '', logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
vi.mock('../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => host.logger } }));
vi.mock('../appSessionState.js', () => ({ peekCommittedAppSession: () => ({ mode: 'local', dataOwnerId: 'test-owner', generation: 1 }) }));

import {
  commitAppearanceSettings, inspectAppearanceSettings, onAppearanceSettingsChanged,
  updateAppearanceSettingsAtomic, writeAppearanceSettingsPatch,
} from '../appearance-settings-store.js';

const file = () => path.join(host.root, 'appearance-settings.json');
beforeEach(() => {
  host.root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-appearance-boundary-'));
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(host.root, { recursive: true, force: true });
});

const invalid: Array<[string, unknown]> = [
  ['uiSize', 30.2], ['uiSize', 12.5], ['uiSize', 11], ['uiSize', 25],
  ['codeSize', 9], ['codeSize', 25], ['codeSize', 10.5],
  ['windowZoom', 0.49], ['windowZoom', 3.01], ['windowZoom', '1'],
  ['uiFamily', `A${String.fromCharCode(1)}B`], ['codeFamily', `A${String.fromCharCode(0)}B`],
  ['uiFamily', 'a'.repeat(257)], ['codeFamily', false], ['uiFamily', []],
  ['uiSize', null], ['codeSize', {}], ['unknownField', true],
  ['wallpaperOverlay', 1.05], ['wallpaperVisibility', -0.1], ['wallpaperBlur', 21],
];
const valid: Array<[keyof AppearanceSettings, string | number]> = [
  ['uiSize', 12], ['uiSize', 24], ['codeSize', 10], ['codeSize', 24],
  ['windowZoom', 0.5], ['windowZoom', 3], ['windowZoom', 1.24],
  ['uiFamily', ''], ['uiFamily', 'a'.repeat(256)], ['codeFamily', ' Example Mono '],
];

describe('appearance persisted and helper validation boundary', () => {
  it.each(invalid)('rejects %s=%j in helper, commit, and raw inspection without repair', async (key, value) => {
    const patch = { [key]: value };
    expect(isValidAppearanceSetting(key, value)).toBe(false);
    expect(() => normalizeHostSettingsChange({ domain: 'appearance', set: patch })).toThrow('INVALID_SETTINGS_CHANGE');
    await commitAppearanceSettings({ set: { uiSize: 16 } });
    const before = fs.readFileSync(file(), 'utf8');
    const listener = vi.fn(); const off = onAppearanceSettingsChanged(listener);
    try {
      await expect(commitAppearanceSettings({ set: patch as Partial<AppearanceSettings> })).rejects.toThrow();
      expect(fs.readFileSync(file(), 'utf8')).toBe(before);
      expect(listener).not.toHaveBeenCalled();
      expect(fs.readdirSync(host.root)).toEqual(['appearance-settings.json']);
      const raw = JSON.stringify(patch);
      fs.writeFileSync(file(), raw);
      expect(inspectAppearanceSettings()).toEqual({ status: 'unreadable', revision: null });
      expect(fs.readFileSync(file(), 'utf8')).toBe(raw);
      expect(host.logger.info).not.toHaveBeenCalled();
      expect(host.logger.warn).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it.each(valid)('accepts %s=%j at the shared boundary with identical effective values', async (key, value) => {
    const patch = { [key]: value };
    expect(isValidAppearanceSetting(key, value)).toBe(true);
    const canonical = normalizeHostSettingsChange({ domain: 'appearance', set: patch }).set;
    const committed = await commitAppearanceSettings({ set: patch });
    const inspected = inspectAppearanceSettings();
    expect(inspected.status).toBe('ready');
    if (inspected.status !== 'ready') throw new Error('fixture unreadable');
    expect(committed.value[key]).toBe(canonical[key]);
    expect(inspected.value[key]).toBe(canonical[key]);
    expect(inspected.customizedKeys).toEqual([key]);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual(patch);
  });

  it.each([
    ['wallpaperOverlay', 1], ['wallpaperVisibility', 0], ['wallpaperVisibility', 1], ['wallpaperBlur', 20],
  ] as const)('keeps upstream wallpaper %s=%j readable without exposing it to Host settings', async (key, value) => {
    expect(isValidAppearanceSetting(key, value)).toBe(true);
    expect(() => normalizeHostSettingsChange({ domain: 'appearance', set: { [key]: value } })).toThrow('INVALID_SETTINGS_CHANGE');
    await commitAppearanceSettings({ set: { [key]: value } });
    const inspected = inspectAppearanceSettings();
    expect(inspected.status).toBe('ready');
    if (inspected.status === 'ready') expect(inspected.value[key]).toBe(value);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite input %j before persistence', async (value) => {
    expect(() => normalizeHostSettingsChange({ domain: 'appearance', set: { windowZoom: value } })).toThrow();
    await expect(commitAppearanceSettings({ set: { windowZoom: value } })).rejects.toThrow();
    expect(fs.existsSync(file())).toBe(false);
  });

  it('retains legacy numeric clamp/round before the final persistence validator', async () => {
    const patch = { uiSize: 30.2, codeSize: 9.8, windowZoom: 8 };
    expect(() => normalizeHostSettingsChange({ domain: 'appearance', set: patch })).toThrow();
    const saved = await writeAppearanceSettingsPatch(patch);
    const normalized = normalizeAppearanceSettings(patch);
    expect(saved).toEqual(normalized);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ uiSize: 24, codeSize: 10, windowZoom: 3 });
    expect(inspectAppearanceSettings()).toMatchObject({ status: 'ready', value: normalized });
    const updated = await updateAppearanceSettingsAtomic(() => ({ uiSize: 15.6, windowZoom: 1.24 }));
    expect(updated).toMatchObject({ uiSize: 16, windowZoom: 1.2 });
    expect(inspectAppearanceSettings()).toMatchObject({ status: 'ready', value: updated });
  });

  it.each(['patch', 'update'] as const)('applies the final validator to legacy %s writers before replacing valid bytes', async (kind) => {
    await writeAppearanceSettingsPatch({ uiFamily: 'Valid Family' });
    const before = fs.readFileSync(file(), 'utf8');
    const listener = vi.fn(); const off = onAppearanceSettingsChanged(listener);
    const invalidFamily = `A${String.fromCharCode(1)}B`;
    try {
      const pending = kind === 'patch' ? writeAppearanceSettingsPatch({ uiFamily: invalidFamily })
        : updateAppearanceSettingsAtomic(() => ({ uiFamily: invalidFamily }));
      await expect(pending).rejects.toThrow('invalid appearance setting');
      expect(fs.readFileSync(file(), 'utf8')).toBe(before);
      expect(inspectAppearanceSettings()).toMatchObject({ status: 'ready', value: { uiFamily: 'Valid Family' } });
      expect(listener).not.toHaveBeenCalled();
      expect(fs.readdirSync(host.root)).toEqual(['appearance-settings.json']);
    } finally { off(); }
  });
});
