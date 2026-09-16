import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '', appData: '', userData: '', security: vi.fn() }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => h.home } };
});
vi.mock('node:child_process', async () => ({
  ...await vi.importActual<typeof import('node:child_process')>('node:child_process'),
  execFileSync: h.security,
}));
vi.mock('electron', () => ({ app: {
  isPackaged: true,
  getPath: (name: string) => name === 'appData' ? h.appData : h.userData,
} }));
vi.mock('../logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock('../maker-host/logger-adapter.js', () => ({ desktopMakerLogger: { child: () => ({ info: vi.fn() }) } }));
vi.mock('../maker-host/nativeProviderAuthBinding.js', () => ({
  isNativeProviderAuthBound: () => true, isNativeProviderCredentialRejected: () => false,
}));

let root: string;
beforeEach(() => {
  vi.resetModules(); h.security.mockReset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-pilot-coexistence-'));
  h.home = path.join(root, 'formal-home'); h.appData = path.join(root, 'appData');
  h.userData = path.join(h.appData, 'Cindy');
  fs.mkdirSync(h.home); fs.mkdirSync(h.userData, { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

async function activate() {
  const module = await import('../cloudPilotDistribution.js');
  const resourcesPath = path.join(root, 'resources'); fs.mkdirSync(resourcesPath);
  fs.writeFileSync(path.join(resourcesPath, module.CLOUD_PILOT_DESCRIPTOR), JSON.stringify({
    version: 1, profile: 'CindyCloudPilot-cn-20260915-r2', region: 'cn',
  }));
  const resolved = module.resolveCloudPilotDistribution({ resourcesPath, appData: h.appData,
    packaged: true, region: 'cn', version: '0.0.0' })!;
  h.userData = resolved.userData;
  return { ...module, ...resolved };
}

it('keeps formal owner markers and Skills untouched through pilot login, fanout and logout', async () => {
  const boundary = await import('../authBoundaryQuarantine.js');
  const skills = await import('../maker-host/shared-global-skills.js');
  const formalMarker = boundary.__testing.filePath();
  const formalSkill = path.join(h.home, '.agents', 'skills', 'formal-only', 'SKILL.md');
  fs.mkdirSync(path.dirname(formalMarker), { recursive: true });
  fs.writeFileSync(formalMarker, 'formal-marker-sentinel');
  fs.mkdirSync(path.dirname(formalSkill), { recursive: true }); fs.writeFileSync(formalSkill, 'formal-skill-sentinel');
  const pilot = await activate();
  expect(boundary.__testing.filePath()).toBe(path.join(pilot.managedHome, '.cindy', 'ghost-skill-projection-boundary.json'));
  await boundary.withGhostSkillProjectionOwnerCommit({ previousOwnerId: null, nextOwnerId: 'pilot-owner',
    prepareTransition: async () => {}, commit: () => {} });
  const privateSkill = path.join(pilot.managedHome, '.agents', 'skills', 'pilot-only');
  fs.mkdirSync(privateSkill, { recursive: true }); fs.writeFileSync(path.join(privateSkill, 'SKILL.md'), 'pilot-skill');
  await skills.prepareSharedGlobalSkillLinks({ isCrossAgentSyncEnabled: () => false });
  expect(fs.realpathSync(path.join(pilot.managedHome, '.claude', 'skills', 'pilot-only'))).toBe(fs.realpathSync(privateSkill));
  await boundary.withGhostSkillProjectionOwnerCommit({ previousOwnerId: 'pilot-owner', nextOwnerId: null,
    prepareTransition: async () => {}, commit: () => {} });
  expect(fs.readFileSync(formalMarker, 'utf8')).toBe('formal-marker-sentinel');
  expect(fs.readFileSync(formalSkill, 'utf8')).toBe('formal-skill-sentinel');
  expect(fs.existsSync(path.join(h.home, '.claude'))).toBe(false);
  expect(fs.existsSync(path.join(h.appData, 'Cindy', 'shared-skill-mutation-locks'))).toBe(false);
  expect(fs.existsSync(path.join(pilot.userData, 'shared-skill-mutation-locks'))).toBe(true);
  expect(boundary.readGhostSkillProjectionBoundaryState()).toMatchObject({ phase: 'stable', ownerId: null });
});

it('selects a separate Keychain service even if the credential module loaded before pilot activation', async () => {
  const credentials = await import('../maker-host/claude-credentials-store.js');
  h.security.mockReturnValue('');
  credentials.readClaudeAiOAuthUnbound();
  expect(h.security.mock.calls[0]?.[1]).toContain('Claude Code-credentials');
  h.security.mockClear();
  await activate();
  h.security.mockImplementation((command: string, args: string[]) => {
    expect(command).toBe('security');
    expect(args).toContain('CindyCloudPilot-cn-r2:Claude Code-credentials');
    if (args[0] === 'find-generic-password') return JSON.stringify({ claudeAiOauth: { accessToken: 'invalid-unit-token' } });
    return '';
  });
  credentials.clearClaudeAiOAuth();
  expect(h.security.mock.calls.map(call => call[1][0])).toEqual(['find-generic-password', 'delete-generic-password']);
});

it('does not adopt the formal Codex auth file or migrate formal legacy themes', async () => {
  const codex = await import('../maker-host/codex-shared-auth.js');
  const formalAuth = codex.getCodexCliAuthPath();
  fs.mkdirSync(path.dirname(formalAuth), { recursive: true }); fs.writeFileSync(formalAuth, 'formal-auth-sentinel');
  const legacyTheme = path.join(h.home, '.xdmaker', 'themes', 'sentinel');
  fs.mkdirSync(path.dirname(legacyTheme), { recursive: true }); fs.writeFileSync(legacyTheme, 'formal-theme');
  const pilot = await activate();
  const themes = await import('../local-themes/loader.js');
  expect(codex.getPreferredSharedCodexAuthPath('pilot-owner')).toBe(path.join(pilot.managedHome, '.codex', 'auth.json'));
  expect(themes.getLocalThemesDir()).toBe(path.join(pilot.managedHome, '.cindy', 'themes'));
  expect(fs.readFileSync(formalAuth, 'utf8')).toBe('formal-auth-sentinel');
  expect(fs.readFileSync(legacyTheme, 'utf8')).toBe('formal-theme');
  expect(fs.existsSync(path.join(h.home, '.cindy', 'themes'))).toBe(false);
});
