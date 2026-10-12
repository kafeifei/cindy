import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createXdtHelperMcpServer } from '../lizi_xdtHelperMcpServer.js';
import type { LiziMcpSessionContext } from '../types.js';
import type { HostSettingsCallbacks } from '../xdt-helper/settings.js';

function payload(result: unknown): Record<string, unknown> {
  const first = (result as { content: Array<{ type: string; text?: string }> }).content[0];
  if (first?.type !== 'text' || !first.text) throw new Error('fixture missing text');
  return JSON.parse(first.text) as Record<string, unknown>;
}
async function setup(agentKind: 'claude-code' | 'codex' | 'pi' = 'codex', surface: 'default' | 'bot' | 'bot-main' | 'restricted' = 'default', withSettings = true) {
  let context: LiziMcpSessionContext = { agentKind, workingDir: '/fixture', sessionId: 'fixture-session' };
  const allowed = vi.fn<HostSettingsCallbacks['allowed']>(async () => true);
  const call = vi.fn<HostSettingsCallbacks['call']>(async (_ctx, tool) => ({ ok: true, tool }));
  const server = createXdtHelperMcpServer({
    ...(withSettings ? { settings: { allowed, call } } : {}),
    resolveSurface: async () => surface,
  }, { agentKind, workingDir: '/fixture', sessionId: 'fixture-session', getSessionContext: () => context });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'settings-fixture', version: '1.0.0' });
  await Promise.all([client.connect(left), server.connect(right)]);
  return {
    client, allowed, call,
    setContext(next: LiziMcpSessionContext) { context = next; },
    async invoke(name: string, args: Record<string, unknown> = {}) {
      return payload(await client.callTool({ name: 'call_tool', arguments: { name, args } }));
    },
    async list(category?: string) { return payload(await client.callTool({ name: 'list_tools', arguments: category ? { category } : {} })); },
    async close() { await client.close(); await server.close(); },
  };
}

describe('Host settings 实际 MCP 传输与参数边界', () => {
  // 这里验证真实 MCP server/transport，不把上下文 fixture 称为 native harness 认证。
  it.each(['claude-code', 'codex', 'pi'] as const)('%s 上下文发现四工具并分派给当前 Host 回调', async agentKind => {
    const fixture = await setup(agentKind);
    try {
      const top = await fixture.client.listTools();
      expect(top.tools.map(tool => tool.name).sort()).toEqual(['call_tool', 'list_tools']);
      expect(await fixture.list()).toMatchObject({ categories: expect.arrayContaining([{ name: 'settings', tool_count: 4 }]) });
      expect(await fixture.list('settings')).toMatchObject({ tools: expect.arrayContaining([
        expect.objectContaining({ name: 'list_settings' }), expect.objectContaining({ name: 'get_settings' }),
        expect.objectContaining({ name: 'update_settings' }), expect.objectContaining({ name: 'get_settings_operation' }),
      ]) });
      await fixture.invoke('get_settings', { domain: 'personalization' });
      expect(fixture.call).toHaveBeenLastCalledWith(expect.objectContaining({ agentKind, sessionId: 'fixture-session' }), 'get_settings', { domain: 'personalization' });
      const mutation = { domain: 'databaseWarning', expected_revision: 'opaque-revision', operation_id: 'host-issued-id', set: { thresholdGiB: 20 }, clear: ['disabled'] };
      expect(await fixture.invoke('update_settings', mutation)).toMatchObject({ ok: true });
      expect(fixture.call).toHaveBeenLastCalledWith(expect.objectContaining({ agentKind }), 'update_settings', mutation);
    } finally { await fixture.close(); }
  });

  it('发现后权限变化，实际执行仍拒绝，旧工具名不是授权', async () => {
    const fixture = await setup();
    try {
      expect(await fixture.list('settings')).toHaveProperty('tools');
      fixture.allowed.mockResolvedValue(false);
      expect(await fixture.invoke('list_settings')).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(await fixture.list('settings')).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(fixture.call).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it('入口检查与 handler 检查之间失效也拒绝', async () => {
    const fixture = await setup();
    try {
      fixture.allowed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      expect(await fixture.invoke('get_settings', { domain: 'appearance' })).toMatchObject({ errorCode: 'SETTINGS_NOT_ALLOWED' });
      expect(fixture.call).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it.each(['bot', 'bot-main'] as const)('%s 继承普通工具类别，但发现与执行仍遵守 Host 设置授权', async surface => {
    const fixture = await setup('pi', surface);
    try {
      // The generic MCP layer inherits ordinary tools. Real Desktop Bot denial
      // comes from the Host's live source resolver, not a second surface policy.
      expect(await fixture.list('settings')).toHaveProperty('tools');
      fixture.allowed.mockResolvedValue(false);
      expect(await fixture.list('settings')).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(await fixture.invoke('update_settings', { domain: 'appearance', expected_revision: 'r', operation_id: 'op', set: { uiSize: 16 } })).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(fixture.call).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it('restricted 能力面即使 Host 回调允许也不暴露或执行全局设置', async () => {
    const fixture = await setup('pi', 'restricted');
    try {
      expect(await fixture.list('settings')).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(await fixture.invoke('list_settings')).toMatchObject({ errorCode: 'CAPABILITY_NOT_AVAILABLE' });
      expect(fixture.call).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it('未注入 Host 设置回调时不出现空壳能力', async () => {
    const fixture = await setup('codex', 'default', false);
    try {
      expect(JSON.stringify(await fixture.list())).not.toContain('settings');
      expect(await fixture.invoke('list_settings')).toMatchObject({ errorCode: 'UNKNOWN_TOOL' });
    } finally { await fixture.close(); }
  });

  it.each(['owner', 'caller', 'session_id', 'instance_id', 'nativeSave', 'consent', 'token', 'path'])('严格拒绝模型传入身份/授权/路径字段 %s', async field => {
    const fixture = await setup();
    try {
      expect(await fixture.invoke('update_settings', { domain: 'personalization', expected_revision: 'r', operation_id: 'op', set: { userPrompt: 'fixture' }, [field]: 'self-claimed' })).toMatchObject({ errorCode: 'INVALID_ARGS' });
      expect(fixture.call).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it('请求正文仅传读取意图，未在工具层伪造确认；每次调用重新取 live context', async () => {
    const fixture = await setup();
    try {
      fixture.setContext({ agentKind: 'codex', workingDir: '/fixture-next', sessionId: 'next-live-session' });
      await fixture.invoke('get_settings', { domain: 'personalization', include_user_prompt: true });
      expect(fixture.call).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'next-live-session', workingDir: '/fixture-next' }), 'get_settings', { domain: 'personalization', include_user_prompt: true });
    } finally { await fixture.close(); }
  });

  it('Host 明确返回已保存但应用失败时不改写结果，未知状态也不重放', async () => {
    const fixture = await setup();
    try {
      fixture.call.mockResolvedValueOnce({ ok: true, receipt: { saved: true, application: 'failed' } });
      expect(await fixture.invoke('update_settings', { domain: 'appearance', expected_revision: 'r', operation_id: 'op', set: { uiSize: 16 } })).toMatchObject({ receipt: { saved: true, application: 'failed' } });
      fixture.call.mockResolvedValueOnce({ ok: true, operation: { status: 'unknown' } });
      expect(await fixture.invoke('get_settings_operation', { operation_id: 'op' })).toMatchObject({ operation: { status: 'unknown' } });
      expect(fixture.call).toHaveBeenCalledTimes(2);
    } finally { await fixture.close(); }
  });
});
