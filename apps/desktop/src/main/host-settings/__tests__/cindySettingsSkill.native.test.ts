/** Native Claude initialization only: disposable HOME/config, fake auth, no model request. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { reconcileSettingsSkill } from '../settings-skill-files.js';
import content from '../skills/cindy-settings/SKILL.md?raw';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const binary = path.join(repo, 'apps', 'claude-code-bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'claude.exe' : 'claude');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function commands(home: string, cwd: string, config: string, disabled: boolean): Promise<string[]> {
  const claudeTmpDir = path.join(home, 'tmp');
  fs.mkdirSync(claudeTmpDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--settings', JSON.stringify({ apiKeyHelper: '', skillOverrides: disabled ? { 'cindy-settings': 'off' } : {} })], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home,
        TEMP: os.tmpdir(), TMP: os.tmpdir(), CLAUDE_CONFIG_DIR: config,
        CLAUDE_CODE_TMPDIR: claudeTmpDir,
        ANTHROPIC_API_KEY: 'invalid-fixture-only', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      },
    });
    let buffer = ''; let result: string[] | undefined; let failure: Error | undefined;
    const timeout = setTimeout(() => { failure = new Error('Native Skill initialization timed out'); child.kill('SIGKILL'); }, 15_000);
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim() || result) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === 'control_response') {
            result = data.response.response.commands.map((item: { name: string }) => item.name);
            child.kill();
          }
        } catch (error) { failure = error as Error; child.kill(); }
      }
    });
    child.on('error', error => { failure = error; });
    child.on('close', () => { clearTimeout(timeout); if (failure || !result) reject(failure ?? new Error('Native initialization returned no catalog')); else resolve(result); });
    child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } }) + '\n');
  });
}

it.skipIf(!fs.existsSync(binary))('Claude discovers the actual isolated config entry and honors disable/re-enable after upgrade', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-settings-native-')); roots.push(root);
  const home = path.join(root, 'os-home'); const managedHome = path.join(root, 'managed-home');
  const profileDir = path.join(root, 'profile'); const cwd = path.join(root, 'project');
  for (const dir of [home, managedHome, profileDir, cwd]) fs.mkdirSync(dir);
  const claudeConfigDir = path.join(profileDir, 'claude-home');
  const layout = { profileDir, homeDir: managedHome, claudeConfigDir };
  expect(reconcileSettingsSkill(layout, content, 1).status).toBe('ready');
  expect(await commands(home, cwd, claudeConfigDir, false)).toContain('cindy-settings');
  expect(await commands(home, cwd, claudeConfigDir, true)).not.toContain('cindy-settings');
  expect(reconcileSettingsSkill(layout, `${content}\nStatic revision.\n`, 2).status).toBe('ready');
  expect(await commands(home, cwd, claudeConfigDir, true)).not.toContain('cindy-settings');
  expect(await commands(home, cwd, claudeConfigDir, false)).toContain('cindy-settings');
  expect(fs.existsSync(path.join(home, '.claude', 'skills', 'cindy-settings'))).toBe(false);
}, 60_000);
