import { z } from 'zod';
import type { LiziMcpSessionContext } from '../types.js';
import type { XdtHelperToolRegistry } from '../lizi_xdtHelperToolRegistry.js';

export type HostSettingsTool = 'list_settings' | 'get_settings' | 'update_settings' | 'get_settings_operation';
export interface HostSettingsCallbacks {
  /** Discovery is checked against the same live authority as execution. Missing authority denies. */
  allowed(context: LiziMcpSessionContext): Promise<boolean>;
  call(context: LiziMcpSessionContext, tool: HostSettingsTool, args: Record<string, unknown>): Promise<unknown>;
}
const domain = z.enum(["newTaskDefaults","personalization","databaseWarning","appearance","wecomNotifications","imWorkspaceProviders","imWorkspaces","telegramGroups","officialHooks","collaboration","agentResource","gitSafety","memory","claudeCompaction","piCompaction","contacts","shortcuts","pluginErrand","pluginCindy","pluginSidebar","contactsSync","browserBackend","computerTools","androidTools","telegramPersona","silentEncryptedRetry","chatEmbedding","lsp","privacy","diagnostics","desktopGeneral","desktopChat","desktopNotifications","linuxWindow","telegramBehavior","terminal","builtinTools","workspaceTools","browserTools","subagentModel","auxiliaryModel","visionBridge","botModelChain","providerNames","modelPrices","modelVisibility","modelEngines","modelFavorites","modelContext","modelAccess","imGlobal","imFeishu","imSlack","imDiscord","imWechat","imTelegram","imDingtalk","imWecom"]);

export function registerHostSettingsTools(registry: XdtHelperToolRegistry, callbacks: HostSettingsCallbacks, context: () => LiziMcpSessionContext): void {
  function register(name: HostSettingsTool, description: string, inputShape: z.ZodRawShape) {
    registry.register({ name, category: 'settings', description, inputShape, handler: async (args) => {
      const current = context();
      if (!await callbacks.allowed(current)) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, errorCode: 'SETTINGS_NOT_ALLOWED' }) }] };
      // Host validates caller, operation and revision again; tools never supply identity or consent.
      const result = await callbacks.call(current, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } });
  }
  register('list_settings', '列出执行 Host 的设置目录、作用范围和专用入口。不是控制端设置，也不改当前任务。', {});
  register('get_settings', '读取一个领域的已保存设置与当前默认解释，返回 revision 和一次操作 ID。个性化正文默认不返回；请求正文会等待 Host 真人确认。不可读时不修复文件。', {
    domain,
    workspace_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    include_user_prompt: z.boolean().optional(),
  });
  register('update_settings', '修改一个领域的白名单 set/clear；先 get_settings 取得 expected_revision 和 operation_id。持久修改必须等待 Host 真人点击，trusted、Full Access 和模型自报确认都不能跳过。clear 删除 override；set 默认值仍保留自定义。结果分别报告保存与应用，超时/结果未知请查询回执和重新读取，不自动重放。', {
    domain,
    workspace_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    expected_revision: z.string().min(1).max(128),
    operation_id: z.string().min(1).max(128),
    set: z.record(z.string(), z.union([
      z.string().max(8000), z.number().finite(), z.boolean(), z.null(),
      z.record(z.string().max(64), z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()])),
      z.array(z.union([z.string().max(8000), z.record(z.string().max(64), z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]))])).max(256),
    ])).optional(),
    clear: z.array(z.string().max(64)).max(16).optional(),
  });
  register('get_settings_operation', '查询当前 owner、当前调用任务的一次操作回执。进程重启或回执过期只返回 unknown，不重新提交。', {
    operation_id: z.string().min(1).max(128),
  });
}
