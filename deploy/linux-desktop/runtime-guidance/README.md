# 云实例配置指引

本目录归客户端云镜像构建维护，不属于普通客户端默认行为。`settings.md` 是云专属正文；
`overlay.mjs` 只在云镜像打包时作为 Vite 插件加入 Desktop main 入口。
普通客户端构建不引用此目录，也不需要新增上游源文件、环境变量或远程协议。

在现有 `appendCloudPluginOauthPrompt` 之后追加同一静态段，覆盖 Claude、Codex、Pi；
仍以 `getInstanceConfig() !== null` 判断云实例。既有前缀逐字节保留，非云实例不追加。
插件检查三个实际装配点，缺失、重复或源码接线变化即停止构建，禁止悄悄遗漏一个引擎。
构建仅在内存转换源码，不回写客户端工作区；构建记录须包含指引摘要及客户端构建前后摘要。

用法：云镜像构建器显式导入 `cloudSettingsGuidancePlugin`，以绝对 `sourceRoot` 指定
客户端源码目录，**仅对 main 入口**添加插件；不要对 preload、renderer 或远程 manager 添加。
这不是自动部署入口。上线仍使用单实例镜像许可与现有 operator 流程，保存原镜像可回滚。
操作记录、真实实例身份、构建产物、凭证和线上验收报告继续在仓库外私有归档。

取消、冲突和未知回执的说明只约束模型解释，不提供写权限或代替确认。
通用 `cindy-settings` Skill、v3 wire、设置 writer 与远程确认卡仍由原模块维护。
测试必须分别证明构建接线、非云不变，以及真实模型的取消/冲突解释；静态文本检查不能代替线上 E2E。

接线回归命令（读取真实客户端 getter，执行转换后正文；不会启动客户端或修改源码）：

```sh
CINDY_TEST_CLIENT_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-guidance/overlay.test.mjs
```

## 对话结果解释与等待边界

云打包还对 `host-settings/helper.ts` 加一个等待原调用完成的结果包装器。`result-guidance.mjs`
只给已返回结果增加 `cloudSettingsGuidance`；原权限检查、参数、正文、回执和错误码逐项保留，
不自行确认、不补写、不重试、不重读配置。非云分支返回原对象。此字段只供模型解释本次 MCP
结果，不进入 v3 设置持久化/设备互联协议，网页和客户端确认卡无需升级。

指引还区分云端实际用途、控制端外观与 Host 桌面偏好，以及 IM 目录清单、历史覆盖与当前绑定。
`imWorkspaces` / `imWorkspaceProviders` 的返回旁明确说明只支持现有身份的偏好，不支持目录
增删改名或路径编辑。不可用结果不推断原因，不伪造管理工具，也不以个人 Telegram Token
配置替代官方 Slack / Telegram / X 登录。缺少服务地址必须有单独证据；登录完成须回读绑定。
这些说明不会补出缺失的服务端点或授权入口，实际接线与真人授权仍须单独验收。

取消后的 `CONFIRMATION_REQUIRED` 与冲突都明确为已结束；元数据明确仅说明当前覆盖状态，
不证明历史；查询回执保留原 operationId。静态云指引同时禁止仅因等待较久就终止 exec 接收器，
因为终止接收器不会取消 Host 卡片。用户主动停止仍按现有停止语义处理，不能借此重放修改。

测试执行真实 helper 的内存转换产物，覆盖鉴权失败、待确认 Promise、原参数/回执不变、取消、
冲突、元数据、允许查看、未知/待处理回执及非云不变。线上验收仍须使用真实延迟点击证明结果
能够返回，不能以包装器单测或指引包含某句话代替模型行为验证。

```sh
CINDY_TEST_CLIENT_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-guidance/*.test.mjs
```
