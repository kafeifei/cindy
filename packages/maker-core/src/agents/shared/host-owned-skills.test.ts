import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAgent } from '../claude-code/index.js';
import { CodexAgent } from '../codex/index.js';
import { PiAgent } from '../pi/index.js';
import type { AgentDeps } from '../base-agent.js';
import type { Logger } from '../../interfaces/logger.js';
import { claudeDisabledSkillOverrides } from './skill-activation.js';

const runtime = vi.hoisted(() => ({ query: vi.fn(), piArgs: [] as string[], piEnv: {} as Record<string, string> }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: runtime.query, forkSession: vi.fn() }));
vi.mock('../pi/transport.js', () => ({
  createPiStdioTransport: (opts: { args: string[]; env: Record<string, string> }) => {
    runtime.piArgs = opts.args; runtime.piEnv = opts.env;
    return { writeLine: async () => {}, onLine: () => () => {}, onStderr: () => () => {}, onClose: () => () => {}, close: async () => {}, pid: 1234, isClosed: () => false };
  }, attachJsonlReader: () => {},
}));
vi.mock('../pi/rpc-client.js', () => ({ PiRpcProcess: class {
  isClosed = false;
  async request(cmd: { type: string }) {
    return { success: true, data: cmd.type === 'get_state'
      ? { sessionFile: path.join(runtime.piEnv.PI_CODING_AGENT_DIR!, 'fixture.jsonl'), model: { provider: 'cindy', id: 'm', contextWindow: 200_000 } } : { entries: [], commands: [] } };
  }
  send() {}
  async close() { this.isClosed = true; }
} }));

const logger: Logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => logger };
let root: string;
let home: string;
let cwd: string;
let source: string;
let disabled: string[];
let revision: string;
let paths: string[];
let prepare: NonNullable<AgentDeps['prepareHostOwnedSkills']>;
function writeSkill(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: cindy-settings\ndescription: Host settings fixture\n---\nStatic guidance only.\n');
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-host-skill-discovery-'));
  home = path.join(root, 'os-home'); cwd = path.join(root, 'project');
  fs.mkdirSync(home); fs.mkdirSync(cwd); fs.mkdirSync(path.join(cwd, '.git'));
  source = path.join(root, 'profile', 'cindy-settings'); writeSkill(source);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(home, '.claude'));
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(home, '.pi', 'agent'));
  runtime.query.mockReset();
  runtime.query.mockReturnValue({
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    setPermissionMode: async () => {}, setModel: async () => {}, applyFlagSettings: async () => {},
    mcpServerStatus: async () => [], interrupt: async () => {}, close: async () => {},
  });
  paths = [source]; disabled = []; revision = 'v1';
  prepare = vi.fn(async () => ({ paths: [...paths], revision }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
function deps(): AgentDeps {
  return { auth: { getState: async () => ({ authenticated: true }), getAuthEnv: async () => ({}), triggerLogin: async () => ({ authenticated: true }), logout: async () => {} },
    runtimeConfig: {}, binaryPath: path.join(root, 'not-spawned'), logger, prepareHostOwnedSkills: prepare,
    getDisabledSkillPaths: () => disabled };
}

describe.each([['claude-code', ClaudeCodeAgent], ['codex', CodexAgent], ['pi', PiAgent]] as const)('%s Host single-entry discovery', (kind, Agent) => {
  it('finds the private profile entry without changing or scanning an extra root', async () => {
    const agent = new Agent(deps());
    const sibling = path.join(path.dirname(source), 'not-injected'); writeSkill(sibling);
    const result = await agent.listCustomizations({ workingDirs: [cwd], kinds: ['skill'] });
    expect(result.items).toEqual([expect.objectContaining({ name: 'cindy-settings', absolutePath: source, engine: kind })]);
    expect(fs.readdirSync(home)).toEqual([]);
    expect(prepare).toHaveBeenCalledOnce();
    const commands = await agent.listCustomizations({ kinds: ['agent'] });
    expect(commands.items).toEqual([]); expect(prepare).toHaveBeenCalledOnce();
  });

  it('does not hide a same-name user entity or inject around a Host conflict', async () => {
    const user = path.join(home, kind === 'claude-code' ? '.claude' : '.agents', 'skills', 'cindy-settings');
    writeSkill(user);
    const agent = new Agent(deps());
    expect((await agent.listCustomizations({ kinds: ['skill'] })).items).toEqual([expect.objectContaining({ absolutePath: user })]);
    paths = [];
    expect((await agent.listCustomizations({ kinds: ['skill'] })).items).toEqual([expect.objectContaining({ absolutePath: user })]);
  });
});

it.each([ClaudeCodeAgent, PiAgent])('local palettes use injected entries, honor disable, and keep management discovery', async Agent => {
  const agent = new Agent(deps());
  const result = await agent.listAgentSkills({ workingDir: cwd });
  expect(result.skills).toContainEqual(expect.objectContaining({ name: 'cindy-settings', path: path.join(source, 'SKILL.md') }));
  disabled = [source];
  expect(agent.filterActiveSkillCommands(result).skills).toEqual([]);
  expect((await agent.listCustomizations({ kinds: ['skill'] })).items).toHaveLength(1);
  expect(claudeDisabledSkillOverrides((await agent.listCustomizations({ kinds: ['skill'] })).items, disabled)).toEqual({ 'cindy-settings': 'off' });
  disabled = [];
  expect(agent.filterActiveSkillCommands(result).skills).toHaveLength(1);
});

it.each([ClaudeCodeAgent, PiAgent])('remote discovery never prepares a controller Skill', async Agent => {
  const agent = new Agent(deps());
  await expect(agent.listAgentSkills({ workingDir: cwd, remoteHostId: 'remote' })).rejects.toThrow(/remote.*file operations/);
  expect(prepare).not.toHaveBeenCalled();
});

it.each([false, true])('Claude startup freezes native skillOverrides for a private Host entry (disabled=%s)', async off => {
  disabled = off ? [source] : [];
  const agent = new ClaudeCodeAgent(deps());
  const handle = await agent.startSession({ sessionId: 'settings-claude', workingDir: cwd, model: 'claude-opus-4-6' });
  try {
    const options = runtime.query.mock.calls.at(-1)?.[0]?.options;
    expect(options.settings.skillOverrides?.['cindy-settings']).toBe(off ? 'off' : undefined);
    expect(prepare).toHaveBeenCalledOnce();
    disabled = off ? [] : [source];
    expect(options.settings.skillOverrides?.['cindy-settings']).toBe(off ? 'off' : undefined);
  } finally { await handle.close(); }
});

it.each([false, true])('Pi startup explicitly loads only the enabled Host entry (disabled=%s)', async off => {
  disabled = off ? [source] : [];
  const agent = new PiAgent({ ...deps(), runtimeConfig: { endpoint: 'http://127.0.0.1:9' },
    resolvePiAgentHome: () => path.join(root, 'pi-home'), resolvePiGlobalContextHome: () => path.join(root, 'pi-global'),
    resolvePiGatewayModelApi: () => 'openai-responses',
    capabilityAdditions: { availableModels: [{ id: 'm', displayName: 'Fixture', contextWindow: 200_000, efforts: [], defaultEffort: null }] },
  });
  const handle = await agent.startSession({ sessionId: 'settings-pi', workingDir: cwd, model: 'm' });
  try {
    const explicit = runtime.piArgs.flatMap((arg, index) => arg === '--skill' ? [runtime.piArgs[index + 1]] : []);
    expect(explicit).toEqual(off ? [] : [source]);
    expect(prepare).toHaveBeenCalledOnce();
    const settings = JSON.parse(fs.readFileSync(path.join(runtime.piEnv.PI_CODING_AGENT_DIR!, 'settings.json'), 'utf8'));
    if (off) expect(settings.skills).toContain(`-${source}`);
    disabled = off ? [] : [source];
    expect(explicit).toEqual(off ? [] : [source]);
  } finally { await handle.close(); }
});

it('Codex retains native skills/list truth and refreshes only on Host revision changes', async () => {
  const agent = new CodexAgent(deps());
  const request = vi.fn(async () => ({ data: [{ cwd, skills: [{ name: 'cindy-settings', description: 'native truth', path: path.join(source, 'SKILL.md'), scope: 'user', enabled: true }], errors: [] }] }));
  // Exercise the actual public list -> private RPC seam, without starting a native process.
  vi.spyOn(agent as never, 'getUtilityHost' as never).mockResolvedValue({ key: 'remote:fixture', host: { request } } as never);
  const first = await agent.listAgentSkills({ workingDir: cwd });
  expect(first.skills[0]?.description).toBe('native truth');
  expect(request).toHaveBeenLastCalledWith('skills/list', { cwds: [cwd], forceReload: true, perCwdExtraUserRoots: null });
  await agent.listAgentSkills({ workingDir: cwd });
  expect(request).toHaveBeenLastCalledWith('skills/list', { cwds: [cwd], forceReload: false, perCwdExtraUserRoots: null });
  revision = 'v2'; await agent.listAgentSkills({ workingDir: cwd });
  expect(request).toHaveBeenLastCalledWith('skills/list', { cwds: [cwd], forceReload: true, perCwdExtraUserRoots: null });
  disabled = [source]; expect(agent.filterActiveSkillCommands(first).skills).toEqual([]);
  request.mockResolvedValue({ data: [{ cwd, skills: [], errors: [] }] });
  expect((await agent.listAgentSkills({ workingDir: cwd })).skills).toEqual([]);
});
