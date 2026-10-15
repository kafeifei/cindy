import path from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import content from './skills/cindy-settings/SKILL.md?raw';
import { cindyManagedHomeDir, isCloudPilotDistribution } from '../cloudPilotDistribution.js';
import { withSkillMutation } from '../skillhub/sharedMutationLease.js';
import { createLogger } from '../logger.js';
import { isOwnedSettingsSkill, reconcileSettingsSkill, SETTINGS_SKILL_NAME, type SettingsSkillLayout, type SettingsSkillResult } from './settings-skill-files.js';

const VERSION = 1;
const CONTENT_REVISION = createHash('sha256').update(content).digest('hex');
const log = createLogger('host-settings-skill');

/** Resolve on each call: Pilot activates after imports; dev may use an isolated Claude config. */
export function hostSettingsSkillLayout(): SettingsSkillLayout {
  const profileDir = app.getPath('userData');
  const homeDir = cindyManagedHomeDir();
  const claudeConfigDir = isCloudPilotDistribution()
    ? path.join(homeDir, '.claude')
    : process.env.CLAUDE_CONFIG_DIR || (process.env.XDT_USER_DATA_DIR && !app.isPackaged
      ? path.join(profileDir, 'claude-home') : path.join(homeDir, '.claude'));
  return { profileDir, homeDir, claudeConfigDir };
}

/** No import-time writes, global sync, preference changes, or credential access. */
export async function prepareHostSettingsSkill(): Promise<SettingsSkillResult> {
  try {
    const result = await withSkillMutation([SETTINGS_SKILL_NAME], async () =>
      reconcileSettingsSkill(hostSettingsSkillLayout(), content, VERSION));
    if (result?.status === 'conflict') log.debug('Host settings Skill has a preserved local conflict');
    return result ?? { changed: false, status: 'unavailable' };
  } catch {
    log.warn('Host settings Skill preparation unavailable');
    return { changed: false, status: 'unavailable' };
  }
}

/** Raw local discovery includes disabled entries; each harness applies the existing activation policy. */
export async function prepareHostSettingsSkillDiscovery(engine: 'claude-code' | 'codex' | 'pi') {
  const result = await prepareHostSettingsSkill();
  const entry = engine === 'claude-code' ? result.entries?.[1] ?? result.entries?.[0] : result.entries?.[0];
  const paths = result.status === 'ready' && entry ? [entry] : [];
  return { paths, revision: JSON.stringify([paths, CONTENT_REVISION]), changed: result.changed };
}

export function isHostSettingsSkillSource(source: string): boolean {
  try { return isOwnedSettingsSkill(source, hostSettingsSkillLayout()); }
  catch { return false; }
}
