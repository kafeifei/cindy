# 原生云实例设置与隔离 Dev 客户端

本分支基于上游 `v0.1.108`，客户端基线为 `d4b39020bf083d79b352fcb56ea5a4941432fb39`。
本文记录截至 2026-10-20 的实现与验收边界。工作分支包含原生设置、隔离 Dev 发行包和
Linux 运行时修复；已经发布的 Linux 镜像只使用构建时冻结的源码子集，不能把整个分支
视为已经全量部署。镜像构建入口及来源记录见本仓
[`deploy/linux-desktop/README.md`](../deploy/linux-desktop/README.md)。

配套服务端使用 [`zhuoshaojian/cindy-server` 的 `feat/cloud-settings-readonly`](https://github.com/zhuoshaojian/cindy-server/tree/feat/cloud-settings-readonly)，
本分支为 [`zhuoshaojian/cindy` 的 `feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client)。
云实例镜像的配套 CI/CD 尚未实现；当前先完成独立构建与本地隔离验收，不把分支提交当作发布记录。

## 接入路径与身份

`设置 → 云实例` 显示当前账号的实例清单，选择实例后进入有明确云端目标标识的原生设置。
复用客户端设置侧栏、搜索、主题、表单和保存组件，覆盖简中、繁中、英语、日语、韩语。
本机设置与云端设置分别取值，云页面不会调用本机配置 hook。

```text
原生设置页面 → preload 封闭方法 → Main 身份/窗口/目标校验
  → CIS 普通客户端入口 → 原有 settingsWeb 队列 → Host settingsManagement
```

Main 持有 Access Token、配置的 HTTPS 服务地址和远程会话 ID。Renderer 只取得本机句柄，
不能覆盖账号、企业、服务地址、控制设备或实例身份。句柄绑定自有顶层 frame；窗口销毁、
导航、账号/区域/设备变化时失效，异步响应前后复核作用域。Token 轮换不等于身份变化。
HTTP 禁止 Cookie、重定向与 referrer，并限制超时和响应体大小。

CIS 通过 `@cindy/auth-verify` 校验普通用户 Bearer，逐请求核对实例归属、企业准入、控制设备、
会话和 runtimeId。该入口不接受 Platform 身份；原网页 Cookie/Origin 和 Host 身份入口不变。
原生准入可以按实例或通过 `settingsWeb.nativeClientAllInstances` 开启；它不扩大账号权限。

## 现有协议的复用

| 路由 | 用途 |
| --- | --- |
| `POST /client/instances/:instanceId/settings/sessions` | 创建短期设置上下文 |
| `POST .../sessions/:sessionId/heartbeat` | 续租 |
| `POST .../sessions/:sessionId/requests` | 原有 SettingsWebCommand |
| `GET .../sessions/:sessionId/requests/:requestId` | 查询原请求，可沿用 resultWait |
| `GET .../sessions/:sessionId/authorizations` | 恢复本会话发起的授权状态 |
| `DELETE .../sessions/:sessionId` | 撤销并回收本会话操作 |

客户端直接引用既有 `settingsWeb.ts` / `settingsManagement.ts` 业务 wire，不新增 Host
resource 或第二套配置执行器。读取按分类并沿用 `readBatch`/`remainingDomains`；缺少能力时
按旧协议降级。每个句柄最多 4 个在途请求。

保存使用原读 revision/operationId；并发冲突保留草稿。POST 响应丢失时查询原 requestId 或
receipt，不自动重发写入。成功后回读。CIS 分开网页、原生与清理队列的归属和容量；撤销只清理
该会话发起的授权，不能取消别人的操作或登出已有账号。

## 授权与回收

供应商、IM、MCP 沿用 `list/run/status/respond/cancel`、动作票据、资源锁和回执。
Main 拒绝跨窗口票据和操作 ID。离页、取消、关闭、过期均有回收路径，不能把“已收到回调”
显示成“账号已绑定”。

OpenAI 等 loopback 授权由 Main 先监听 Host 指定的本机回环地址、非特权端口和回调路径，
核对唯一 state 后沿原 respond 命令发送到同一云实例操作。PKCE、换票和持久化继续由云端 CLI
完成，不同步凭证。端口冲突不抢占；完成时等待本机 HTTP 结果页发完再释放监听，取消立即释放。
云端远程 Codex 登录只在该子进程设 `BROWSER=/bin/true`，避免额外打开无人管理的浏览器。
授权浏览器回收确认目标消失和进程退出，处理关闭与目标自行销毁的竞态。

## 实例领取、状态与维护

- 空列表提供显式“领取云实例”，复用既有无 ID wake 分支。已有实例唤醒始终带 ID；写前核对
  归属，响应不明只查询结果，不自动重放领取。
- `loginRequired` 走既有 CIS 登录尝试与组织 SSO。短期 continuation 只在 Main 与 CIS 登录页
  间传递，不进 Renderer、日志或磁盘；不复制本机凭证到云端。
- 概览独立于 Host 设置会话，休眠时仍可显示状态和唤醒。休眠确认具体目标与任务影响。
  可见页面转换状态每 5 秒、稳定状态每 30 秒读取，禁止同实例重复写入。
- 云版本、可用更新与本机版本分别显示。自动更新及维护时段显式保存，携带 revision 与
  defaultsRevision，保留任务保护策略。开启开关不等于立即升级。
- 维护时区使用可搜索 IANA 选择器；维护方式字段固定宽度，菜单不因选项文字长短收缩。
  自定义时段支持每周日期、跨午夜和重叠校验，不提供修改定时任务的入口。

## 隔离 Dev 发行包

版本格式 `<上游版本>-dev.cloud.<YYYYMMDD>.<构建序号>`，例如 `0.1.108-dev.cloud.20261016.1`。
CN / Apple Silicon 包名 `Cindy Cloud Dev CN.app`，bundle ID `com.xd.cindycn.clouddev`，
Helper 使用同一专属命名空间。包内校验后的 `cloud-pilot-distribution.json` v2 固定专属 profile，
且版本与应用版本精确一致。

在鉴权和业务模块加载前分离 userData、sessionData、appData、钥匙串身份、持久设备 ID 及
Cindy 管理的 home。Claude/Codex/GitHub/Pi、Skills、浏览器与托管 SSH 不继承正式版数据。
不注册正式版 URL scheme/文件关联，不执行正式版更新检查、暂存补丁或重启更新，也不自动移入
正式版路径。普通发行包继续走原行为。

分享包只含应用、说明和校验信息，不含本机 profile。ad-hoc 签名必须注明未公证，不要求关闭
全局 Gatekeeper。Dev 的本机数据独立，但登录后操作的是账号的真实云实例。

## 验收边界

已完成本人实例的原生读取、保存回读、revision 冲突、会话撤销及 OpenAI 最终授权回写验收；
GitHub Copilot 真实授权按用户要求跳过。实际隔离客户端验证了设置入口、返回、时区选择及
已有实例展示。首次领取/SSO 的自动化覆盖使用受控响应，未据此声称真实首次领取 E2E 通过。
五语、双主题和宽度矩阵含独立组件夹具，不能等同于所有平台实机验收。

当前能力缺口仍明确保留：协议未暴露个性化原文时不提供原文编辑，Git 布尔字段不猜测三档语义；
插件/专用 CLI 独立发起和通用 MCP 浏览器 OAuth 不因试用组件存在就视为线上可用。既有会话授权卡
继续沿用原能力。DEV `/cloud-settings-trial` 为内存演示，不访问真实实例或账号。

Linux 输入与授权浏览器修复另有隔离 X11 回归；它不代表 DeviceLink 跨端端到端输入验收。
本次整理源码不执行部署或修改实例状态。
