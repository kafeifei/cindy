/**
 * Opt-in native provenance regression, not a mocked query or hand-fed hook input.
 * Run with CINDY_CLAUDE_SETTINGS_PROVENANCE_NATIVE=1. Only the model and helper
 * business handlers are fakes; SDK, bundled CLI, Agent tool, MCP transport and
 * PreToolUse callback dispatch are real. No Desktop auth/Skill preparation runs.
 * macOS Seatbelt also prevents outbound traffic, user-home access and keychain
 * service access; unsupported hosts skip rather than weaken this isolation.
 * Auto is intentionally not claimed here: 2.1.259 asks its security-monitor
 * model before Agent dispatch. This fixture does not emulate that classifier
 * or loosen native permissions to force child startup.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkMcpServer, query, tool, type HookInput, type HookJSONOutput, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { expect, it } from 'vitest';
import {
  buildClaudeHostSettingsCallerProvenanceHooks,
  CLAUDE_SUBAGENT_HOST_SETTINGS_DENIAL_REASON,
} from '../../../../../../packages/maker-core/src/agents/claude-code/capability-routing.js';

const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const binary = path.join(repo, 'apps', 'claude-code-bin', `${process.platform}-${process.arch}`, 'claude');
const enabled = process.env.CINDY_CLAUDE_SETTINGS_PROVENANCE_NATIVE === '1';
const supported = process.platform === 'darwin' && fs.existsSync(binary) && fs.existsSync('/usr/bin/sandbox-exec');
const model = 'claude-opus-5'; // A wire label only: all inference is a local deterministic fixture.
const listTool = 'mcp__cindy_helper__list_tools';
const callTool = 'mcp__cindy_helper__call_tool';
const childMarker = 'NATIVE_SETTINGS_PROVENANCE_CHILD';
const deniedCalls = [
  { id: 'child_overview', name: listTool, input: {} },
  { id: 'child_settings_catalog', name: listTool, input: { category: 'settings' } },
  ...['list_settings', 'get_settings', 'update_settings', 'get_settings_operation'].map(name => ({
    id: `child_${name}`, name: callTool, input: { name, args: {} },
  })),
];

/** Small scripted Messages response, consumed by the actual native model client. */
function reply(res: ServerResponse, content: Array<Record<string, unknown>>, sequence: number) {
  const events: Array<Record<string, unknown>> = [{
    type: 'message_start', message: {
      id: `msg_provenance_${sequence}`, type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  }];
  content.forEach((block, index) => {
    events.push({ type: 'content_block_start', index, content_block: block.type === 'tool_use'
      ? { ...block, input: {} } : { type: 'text', text: '' } });
    events.push({ type: 'content_block_delta', index, delta: block.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
      : { type: 'text_delta', text: block.text } });
    events.push({ type: 'content_block_stop', index });
  });
  events.push(
    { type: 'message_delta', delta: { stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  );
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

it.skipIf(!enabled || !supported).each(['default', 'bypassPermissions'] as PermissionMode[])(
  'native child settings calls are denied before helper dispatch (%s)',
  async permissionMode => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-claude-settings-provenance-')));
    const home = path.join(root, 'home');
    const profile = path.join(root, 'profile');
    const config = path.join(profile, 'claude-home');
    const cwd = path.join(root, 'project');
    const tmp = path.join(root, 'tmp');
    for (const directory of [home, profile, config, cwd, tmp]) fs.mkdirSync(directory, { recursive: true });
    const children: ChildProcessWithoutNullStreams[] = [];
    const helperCalls: Array<{ tool: string; args: unknown }> = [];
    const observed: Array<{ input: HookInput; output: HookJSONOutput }> = [];
    const nativeChildIds: string[] = [];
    const requests: string[] = [];
    const errors: string[] = [];
    let childDenialResults = 0;
    let rootRequests = 0;
    let childRequests = 0;
    let stderr = '';
    let nativeInit: unknown;
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        try {
          if (req.url === '/api/hello') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
          if (req.url?.includes('count_tokens')) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ input_tokens: 100 }));
            return;
          }
          if (!req.url?.startsWith('/v1/messages')) throw new Error(`Unexpected local endpoint: ${req.url}`);
          const body = JSON.parse(raw);
          requests.push(req.url);
          // The child has an exclusive system marker; root's Agent arguments are
          // deliberately not used for classification (they also contain it).
          const isChild = JSON.stringify(body.system).includes(childMarker);
          if (!isChild && !JSON.stringify(body.system).includes('Native provenance root fixture.')) {
            throw new Error('Unsupported auxiliary native model request (fixture covers only root and child turns)');
          }
          let content: Array<Record<string, unknown>>;
          if (isChild && childRequests++ === 0) {
            content = [
              ...deniedCalls.map(call => ({ type: 'tool_use', ...call })),
              { type: 'tool_use', id: 'child_other_catalog', name: listTool, input: { category: 'capabilities' } },
              { type: 'tool_use', id: 'child_other_call', name: callTool, input: { name: 'get_capabilities', args: {} } },
            ];
          } else if (isChild) {
            const results = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content : [])
              .filter((block: { type: string }) => block.type === 'tool_result');
            for (const call of deniedCalls) {
              const result = results.find((block: { tool_use_id: string }) => block.tool_use_id === call.id);
              expect(result, `Native tool result for ${call.id}`).toMatchObject({ is_error: true });
              expect(JSON.stringify(result)).toContain(CLAUDE_SUBAGENT_HOST_SETTINGS_DENIAL_REASON);
            }
            childDenialResults = deniedCalls.length;
            content = [{ type: 'text', text: 'Native child received all six settings denials.' }];
          } else if (rootRequests++ === 0) {
            expect(body.tools.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['Agent', listTool, callTool]));
            // A real positive MCP control rules out a disconnected helper server.
            content = [{ type: 'tool_use', id: 'root_settings_control', name: callTool, input: { name: 'get_settings', args: { fixture: 'root' } } }];
          } else if (rootRequests === 2) {
            content = [{ type: 'tool_use', id: 'root_agent', name: 'Agent', input: {
              description: 'Verify native caller provenance', subagent_type: 'settings-probe',
              prompt: 'Run the local settings provenance fixture.', run_in_background: false,
            } }];
          } else {
            content = [{ type: 'text', text: 'NATIVE_PROVENANCE_DONE' }];
          }
          reply(res, content, requests.length);
        } catch (error) {
          errors.push(String(error));
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Local provenance fixture rejected the request' } }));
        }
      });
    });
    let run: ReturnType<typeof query> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      const env = {
        // Allowlist, not process.env spread; no developer credentials or proxies.
        PATH: '/usr/bin:/bin', HOME: home, USERPROFILE: home, TMPDIR: tmp, TEMP: tmp, TMP: tmp,
        XDT_USER_DATA_DIR: profile, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_TMPDIR: tmp,
        ANTHROPIC_API_KEY: 'invalid-local-fixture-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_SMALL_FAST_MODEL: model, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
        CLAUDE_CODE_DISABLE_CRON: '1', DISABLE_AUTOUPDATER: '1',
      };
      // No home-based settings or credential access, even if native startup changes.
      // Only the explicitly selected bundled executable is readable under /Users.
      const sandbox = `(version 1)
(allow default)
(deny file-read* (require-all (subpath "/Users") (require-not (literal ${JSON.stringify(fs.realpathSync(binary))}))))
(deny file-write* (require-all (require-not (subpath ${JSON.stringify(root)})) (require-not (literal "/dev/null"))))
(deny file-read* (subpath "/private/tmp") (subpath "/tmp"))
(deny process-exec (literal "/usr/bin/security"))
(deny mach-lookup (global-name "com.apple.securityd"))
(deny network-outbound (require-not (remote ip "localhost:${port}")))`;
      const hooks = buildClaudeHostSettingsCallerProvenanceHooks();
      hooks.PreToolUse = hooks.PreToolUse!.map(matcher => ({ ...matcher, hooks: matcher.hooks.map(callback => async (input, id, context) => {
        const output = await callback(input, id, context);
        observed.push({ input, output });
        return output;
      }) }));
      hooks.SubagentStart = [{ hooks: [async input => {
        if (input.hook_event_name === 'SubagentStart') nativeChildIds.push(input.agent_id);
        return { continue: true };
      }] }];
      const helper = createSdkMcpServer({ name: 'cindy_helper', version: '1.0.0', tools: [
        tool('list_tools', 'Local fixture metadata only', { category: z.string().optional() }, async args => {
          helperCalls.push({ tool: listTool, args });
          return { content: [{ type: 'text', text: 'Fixture catalog' }] };
        }),
        tool('call_tool', 'Local fixture dispatcher only', { name: z.string(), args: z.record(z.string(), z.unknown()).optional() }, async args => {
          helperCalls.push({ tool: callTool, args });
          return { content: [{ type: 'text', text: 'Fixture helper response; no real settings are accessed' }] };
        }),
      ] });
      run = query({ prompt: 'Run the isolated native provenance fixture.', options: {
        pathToClaudeCodeExecutable: binary, cwd, env, model, permissionMode,
        allowDangerouslySkipPermissions: true, settingSources: [], persistSession: false,
        settings: { apiKeyHelper: '', autoMemoryEnabled: false },
        tools: ['Agent', listTool, callTool], allowedTools: ['Agent', listTool, callTool],
        mcpServers: { cindy_helper: helper }, strictMcpConfig: true,
        systemPrompt: 'Native provenance root fixture.', maxTurns: 5,
        agents: { 'settings-probe': { description: 'Local provenance fixture child', prompt: childMarker, tools: [listTool, callTool], model: 'inherit', maxTurns: 3 } },
        hooks,
        spawnClaudeCodeProcess: options => {
          expect(options.command).toBe(binary);
          expect(options.cwd).toBe(cwd);
          for (const target of [home, profile, config, cwd, tmp, path.join(config, 'skills'), path.join(home, '.claude', 'skills')]) {
            expect(path.relative(root, target).startsWith('..')).toBe(false);
          }
          const child = spawn('/usr/bin/sandbox-exec', ['-p', sandbox, binary, ...options.args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
          children.push(child);
          child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
          return child;
        },
      } });
      deadline = setTimeout(() => { errors.push('Native provenance deadline exceeded'); run?.close(); for (const child of children) child.kill('SIGKILL'); }, 40_000);
      let completed = false;
      let nativeVersion: string | undefined;
      for await (const event of run) {
        if (event.type === 'system' && event.subtype === 'init') {
          nativeVersion = event.claude_code_version;
          nativeInit = { version: nativeVersion, mode: event.permissionMode, mcp: event.mcp_servers, tools: event.tools };
          expect(event.permissionMode).toBe(permissionMode);
          expect(event.mcp_servers).toContainEqual({ name: 'cindy_helper', status: 'connected' });
        }
        if (event.type === 'result') {
          expect(event, JSON.stringify({ errors, stderr })).toMatchObject({ subtype: 'success', is_error: false, result: 'NATIVE_PROVENANCE_DONE' });
          completed = true;
          break;
        }
      }
      expect(errors, stderr).toEqual([]);
      expect(completed, stderr).toBe(true);
      expect(nativeVersion).toBeTruthy();
      expect(nativeChildIds).toHaveLength(1);
      expect(nativeChildIds[0]).not.toBe('');
      expect(childDenialResults).toBe(6);
      expect(childRequests).toBe(2);
      expect(rootRequests).toBe(3);
      expect(helperCalls).toHaveLength(3);
      expect(helperCalls).toEqual(expect.arrayContaining([
        { tool: callTool, args: { name: 'get_settings', args: { fixture: 'root' } } },
        { tool: listTool, args: { category: 'capabilities' } },
        { tool: callTool, args: { name: 'get_capabilities', args: {} } },
      ]));
      for (const call of deniedCalls) {
        const observation = observed.find(entry => entry.input.hook_event_name === 'PreToolUse' && entry.input.tool_use_id === call.id);
        expect(observation?.input).toMatchObject({ agent_id: nativeChildIds[0], permission_mode: permissionMode, tool_name: call.name, tool_input: call.input });
        expect(observation?.output).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: CLAUDE_SUBAGENT_HOST_SETTINGS_DENIAL_REASON } });
      }
      const rootObservation = observed.find(entry => entry.input.hook_event_name === 'PreToolUse' && entry.input.tool_use_id === 'root_settings_control');
      expect(rootObservation?.input.agent_id).toBeUndefined();
      expect(rootObservation?.output).toEqual({ continue: true });
    } catch (error) {
      throw new Error(`${String(error)}\n${JSON.stringify({ errors, stderr, nativeInit, rootRequests, childRequests, helperCalls, observed })}`);
    } finally {
      if (deadline) clearTimeout(deadline);
      run?.close();
      await Promise.all(children.map(child => new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
        child.once('close', () => resolve());
        child.kill('SIGKILL');
      })));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  50_000,
);
