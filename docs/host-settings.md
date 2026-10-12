# Host 设置与会话入口

## 边界

设置属于**运行任务的 Host**，不是控制端电脑，也不是 CIS 管理网页。Host 持有设置真值；CIS 接收脱敏快照；按实例开启网页编辑时，还短期加密转送用户明确提交的命令及回执。本文描述隔离云版本线中的实现合同，不代表已经部署到现有实例。

可写目录由原四个领域扩展为 58 个固定领域，由 `settingsEditableCatalog.ts` 定义并与服务端校验对齐。是否显示还取决于当前 Host 的平台、已连接能力及原生配置状态；未连接的插件或 IM 工作区没有伪造选项。`list_settings` 返回的资源、动作和授权入口仍用于指路。当前任务的模型与运行参数继续使用 `get_session_runtime` / `set_session_runtime`，不能用新任务默认值去修改存活任务。资源、镜像、启停、更新属于 CIS/平台策略。

| 领域 | 字段 | 归属 | 保存后的生效边界 |
| --- | --- | --- | --- |
| `newTaskDefaults` | `harness`、`providerId`、`modelId`、`effort`、`fast`、`thinking`、`worktree`、`planMode` | 当前 owner | 后续新任务；不改变默认权限 |
| `personalization` | `userPrompt`，最多 8000 字符 | 当前 owner | 后续 Agent 启动；存活任务保持启动快照 |
| `databaseWarning` | `thresholdGiB`（1–1024）、`disabled` | 当前 Host profile | 立即更新提醒策略，不修改数据库内容 |
| `appearance` | `uiFamily`、`codeFamily`（最多 256 字符）；`uiSize`（整数 12–24）、`codeSize`（整数 10–24）、`windowZoom`（0.5–3，步长 0.1） | 当前 Host profile | 应用到该 Host 桌面，不改变控制端或网页 |

目录另外覆盖记忆与压缩、模型供应商与专用路由、语言与通知、主题与布局、浏览器/电脑使用、语音与媒体、隐私与诊断、存储维护、终端与 Git 偏好。其中普通持久偏好由原生存储适配到网页与会话工具；硬件、凭据和资源操作仍保留专用入口，不改变控制端配置。数据删除、日志上传和凭据授权不能因为出现在目录中就被视为已获授权。

模型与来源必须经过执行端实际目录验证。查询只读取本地已有目录，不为了查询刷新授权或修复配置；没有可用推荐时返回空模型/来源，不编造 Opus 等占位型号。IM/插件权限只能选择既有的固定权限档，不能授权通用工具本身；凭据、任意文件路径和原始配置 JSON 不属于此接口。

## 字段级只读目录

只读目录由 `apps/desktop/src/shared/settingsReadCatalog.ts` 定义，与扩展的认证写入合同分开。目录记录稳定 ID、实际控件与真源、作用域、适用平台、生效边界、读取域和隐私投影。`SETTINGS_READ_FIELD_IDS`、`SETTINGS_READ_COLLECTION_IDS` 是封闭集合，不接受任意设置键。

| 类别 | 本次覆盖 | 读取与展示含义 |
| --- | --- | --- |
| 设置分区 | 实际 18 个 tab | 与 `TAB_IDS`、真实设置组件连接校验；不是“18 个值均读取成功” |
| 固定字段 | 453 个独立叶子 | 每份 v2 都必须有值和来源，或明确的不可用/不可读/不适用/待迁移/隐私状态；预算不足不能删字段 |
| 动态配置 | 15 个封闭集合 | 只读已知持久项；逐类报告完整性、总量与省略量，未知总量不冒充完整 |
| 外部项目 | 26 个资源、动作、授权或外部入口 | 只登记真实归属和专用入口，不计入“已读取 Host 设置值” |

固定字段包括原四域、Agent/资源/Git/记忆/压缩/模型路由、语音、浏览器与电脑使用、IM、桌面交互和外设。独立覆盖锚点包含 IM global + 七渠道共 96 个默认叶子、27 个快捷键定义的适用项、WorkLouder 两型号的七组设置及完整布局叶子、gamepad 四类别的两组设置及全部按钮/摇杆、桌面 20 组展开的 25 个叶子。平台不适用的快捷键等仍有明确状态，不从报告删除。

动态集合为 `modelVisibility`、`modelEngines`、`modelFavorites`、`modelDisable`、`providerPresentation`、`modelContextBudget`、`modelPrices`、`modelParameterHistory`、`visionBridgeTargets`、`imWorkspacePrefs`、`telegramGroupActivation`、`builtinToolOverrides`、`pluginSidebar`、`pluginCindyPrefs`、`pluginErrandPrefs`。不为填满这些集合扫描所有工作区、刷新供应商目录或读取插件任意 KV/DOM/secrets。

账号/账单、内容库、插件 `settingsHtml`、官方远端 Telegram 行为、授权、安装、更新、清理与备份等维持专用入口。系统授权或驱动可用性不冒充保存的启用偏好；企业微信通知偏好与加密凭据同存，当前只读报告为 `private`，不能为展示它调用解密。

### 只读事实与公开投影

- `readSnapshot.ts` 聚合各领域无副作用 inspection，再由 `snapshotProjectionV2.ts` 逐字段新建公开报告；不能序列化完整 Native snapshot、prompt、history、revision、operationIds 或 owner stamp。
- 读取复用实际 store 的类型、枚举、范围和默认解释，不调用会 ensure、迁移、修复、删坏文件、读取凭据或探测权限的旧 getter；不请求网络、不启动设备。坏领域隔离失败，身份/profile 变化则整次采样失效，不承诺多文件全局事务。
- 保留入口原有差异：原生 UI 的 clamp/round、工具严格拒绝、历史空/null/退役型号都按所属领域解释；wire 校验不能反向放宽原生 mutation 或历史配置 grammar。
- 来源分别是 `default`、`override`、`unknown`。显式保存默认值仍是 override；历史完整快照没有逐字段意图证据时只能标未知，不能按值相等推断来源。
- 模型/来源只有属于随包 `BUNDLED_CATALOG` 的精确公共成员，且通过保守 wire 语法，才可上传公开 ID。活动目录、组织发现、用户连接、前缀、别名或 regex 命中都不是公开性证明；无法证明时只上传配置状态。正文、路径、自由文本、字体名、设备身份以及它们的摘要/hash 均不上传。
- `migrationPending` 表示尚未完成原生领域迁移，不是默认值，也不允许由快照读取自动认领或导入旧数据。网页的未上报、旧版未包含和过期状态另行区分，不能都归成“未配置”。

## 工具流程

从 `cindy_helper` 的 `settings` 类目发现四个工具：

1. `list_settings`：读取完整能力目录、作用范围及其它专用入口。
2. `get_settings({ domain })`：读取一个领域及来源，取得 `revision` 和 Host 发行的 `operationId`。
3. `update_settings({ domain, expected_revision, operation_id, set?, clear? })`：单领域白名单修改；等待原生任务确认卡。
4. `get_settings_operation({ operation_id })`：读取保存回执；不重放操作。

例如将数据库提醒设为 20 GiB，应先读取 `databaseWarning`，再用那次读取给出的 revision/operationId 提交 `set: { thresholdGiB: 20 }`。恢复默认用 `clear: ['thresholdGiB']`，不能把某一版本的默认阈值写成固定 override。

`set` 等于默认值也记录明确的自定义意图；`clear` 删除 override，随后跟随版本默认值。一次请求不能跨领域，也不承诺多个配置文件的全局事务。

## 身份与真人确认

- 发现和执行均从可信上下文反查当前 owner、live Session 实例、根调用者和执行来源；参数不能自报 owner、caller 或目标实例。
- Claude 本地原生子代理继承的 MCP 闭包仍属于父任务，因此在 SDK `PreToolUse` 用逐调用 `agent_id` 拦截四个设置工具及设置类目发现。未指定类目的 helper 总览也包含设置目录，子代理需由根任务代查总览；其它明确 helper 类目的发现和调用不受该拦截影响。该拦截独立于 Ask、Auto、Full Access，不依赖 `canUseTool` 一定触发。
- Codex 按可信 thread 路由保留调用来源；同一 instance 的 root/descendant 或不同证明状态不能作为等价 alias，也不能在混合 batch 中互相覆盖。缺少 threadId 的兼容请求仍可使用原有 session 能力，但来源降为 `unknown / false`，不能据 instance URL 获得设置权限；未知 thread 和过期 instance 不回退猜测身份。
- Pi 的 MCP 上下文透传 `remoteHostId`；设置入口还独立检查 live Session 的远端归属。即使桥接上下文漏掉该字段，SSH 任务也不能发现、查询或修改控制端 Host 设置，不能进入其确认流程。
- Bot、群聊、调度、非 owner、SSH、Plan/只读等不满足当前授权条件的上下文不能借此写入 Host 全局设置。
- 工具写入必须经过 Host 自己的 pending confirmation，一次批准只针对捕获的目标、变更、revision 和身份代次。Full Access、trusted helper 身份、模型提供的 token 或 `updatedInput` 均不能替代真人点击。
- 确认后、等文件锁后、发布文件前重验身份与 revision。关闭任务、超时、账号/权限代次变化会使旧确认无效。
- 本机设置页的保存是独立的可信 Renderer IPC 入口，不重复弹确认；该入口不暴露为工具参数。
- 远程确认复用任务的 `permission` 卡、pending 快照和 resolve 回执，不要求打开云端桌面。桌面和手机在 link-open 与 subscribe 共用的能力列表中声明 `host-settings-confirmation-v1`，完整显示捕获的变更（含长正文），仅提供一次允许或拒绝。
- Host 仍校验实际可信 device-link 来源和该能力。旧控制端即使直接发送批准响应也被拒绝，但不能取消另一个控制端仍可确认的卡。断线重连获取同一待确认请求；重复回执只能结算一次，过期请求不能补写配置。
- 设置确认卡只显示设置名称、原值 → 新值和生效说明，按钮为「取消 / 保存修改」；恢复默认明确显示「跟随默认」。桌面和手机复用已有任务确认入口，不显示原始 JSON、工具名、revision 或 operationId。长正文可以完整滚动查看；描述旧个性化状态时只显示是否设置，不读取或披露旧正文。
- 显示内容由 Host 根据捕获且已校验的变更生成，经现有 permission input 的 `preview` 字段传递。控制端只解析版本为 1 的有界纯文本结构，不执行 HTML，不将显示内容作为写入参数；实际批准仍绑定 Host 捕获的变更与身份。缺少有效 preview 的旧 Host 请求不可在新版界面批准，需 Host 一并更新；不能回退为 JSON 或无内容批准。独立的正文查看请求仍使用「允许查看」，不混作保存。
- 个性化普通查询仅返回是否自定义。请求 `include_user_prompt: true` 仍需单独的 Host 真人确认，不能由模型传“已授权”解锁。
- 插件 OAuth、API Key/PAT 和其它秘密继续使用原有专用授权/保密输入卡片，不经通用设置工具传递。

## 保存、并发和回执

配置文件适配器在文件锁中重新读盘、检查作用域和 CAS 后原子发布；已改造的同文件原 UI writer 共用该边界。IM hook 原有同步写入仍由 Host 主线程串行执行；官方 hook 偏好复用一次同步原子 rename，vault 中的企业微信开关复用原生串行 secret writer，不承诺跨进程或多文件事务。查询只读：损坏文件返回不可读，不删除、不修复、不把默认值伪装成成功读取的真实设置。

revision 是进程 HMAC 的不透明内容比较标记，包含 override、当前默认解释和作用域；不是单调历史编号。重启后旧 revision 失效，不承诺发现外部修改后又恢复原状的 ABA。

操作 ID 只作相关性和进程内幂等键，不是授权凭证。它绑定 owner/generation、调用任务、领域、revision 和规范化请求；同 ID/同请求返回既有回执，不同请求拒绝。回执有界，正文不写入回执。进程重启或过期返回未知，先回读，不自动重放。

| 字段 | 含义 |
| --- | --- |
| `saved: true` | 已原子保存到 Host |
| `application: next_task` | 后续新任务生效 |
| `application: next_agent_start` | 后续 Agent 启动生效 |
| `application: applied` | 当前应用回调已完成 |
| `application: failed` 且 `saved: true` | 已保存，但窗口/运行时应用失败；不能报告成未保存 |
| `status: unknown` 或 `OUTCOME_UNKNOWN` | 不掌握操作结果；回读或查询回执，不能自动再写 |

发布前完成可失败的序列化、默认解释及回执构造；发布后不依赖再次读盘才能确认保存。通知订阅者失败不改变写入结果。初始化迁移发现已经初始化时不重写文件、不发布虚假的设置变化。

## Renderer 偏好迁移

新任务偏好和个性化从 Renderer localStorage 迁入 owner-scoped Host 文件，不复制整个 localStorage。

- 导入受 owner/generation 和 revision 保护，仅初始化未迁移领域。Host 已经修改或恢复默认的领域不能被旧 Renderer 覆盖。
- 初始化标记不随 reset 删除；旧值保留用于人工处理冲突，但不再作为正常读写真值。
- 新任务偏好保留显式选模标记、各引擎/来源历史型号、per-model tuning、lastModel 与已有权限偏好；不迁草稿正文、附件、工作目录、临时设备或额外可写目录。
- 远程新任务默认值快照增加兼容可选字段 `hostAuthoritative` 与 `planMode`。新控制端看到 Host 权威标记时保留其显式型号与空态，不用控制端推荐替换；计划默认来自执行 Host，发送任务后不反写为关闭。旧 Host 不带标记时维持既有消费路径；旧控制端忽略新字段，不承诺获得新版显式型号保护。Mobile 原有消费范围不在本轮扩展。
- Worker 与远程草稿的 effort 优先级保持各自原合同。
- Renderer 只持有可重建缓存，等待 Host 保存回执后才显示成功。旧回读不能覆盖较新的通知；保存等待期间切换身份不把旧草稿写给新 owner。
- 个性化编辑保留未保存草稿；外部更新造成 revision 冲突时禁止覆盖，提示保留草稿并重新打开设置。恢复默认调用 `clear`，显式保存空串仍然是 override。
- 个性化由执行 Host 在原启动装配点读取，随后沿原顺序追加项目上下文；控制端不再发送自己的正文副本。公共 system prompt 与各引擎拼接顺序不变。

### 本次新增的 profile 与 owner 正本

- **Profile 桌面偏好**：主题/主题族、语言、sidebar 与 ghost panel 布局、桌面/飞书通知、点击/发送/链接行为、淡入、推荐、消息导航条、Agent Island 启用/音效/皮肤/显示目标、持久化网络调试，共 20 组、25 个公开叶子。正本迁入 `host-desktop-preferences.json`；自定义主题、音效文件和显示器身份仍仅存本机。目录以 `scope: profile` 和 `surface: hostDesktop` 区分所属 profile 与应用到 Host 桌面的展示语义。
- **Owner 模型偏好**：模型显示 override、引擎偏好和收藏迁入 `host-model-presentation-preferences.json`。保留初始化默认规则、follow-catalog 记录、收藏顺序/身份与 seed 墓碑；不把它们错误迁为 profile，也不重复迁移已接入的 `providerModelMemory`。
- **本机桥**：仅执行 Host 同一 profile 的可信本地 Renderer，可经固定 preload/IPC 通道读取、一次性导入和保存。桌面与模型桥同时校验可信顶层 frame、实际 profile partition 与 Host 注册的窗口身份；仅本机主、副应用窗口可写，登记为只读的辅助窗不可写，remote viewer 明确排除，提交前重新校验。同步启动桥只读，避免重建缓存时闪回默认主题/语言。控制端、远控窗口、网页或工具参数不能冒充本机导入者。
- **提交与缓存**：profile 写入受 profile stamp/revision 保护，owner 写入另受 owner/generation 保护；都在真实锁内 CAS 与原子提交。多窗口冲突只回读，不换 revision 重放旧整表。初始化标记不随恢复默认删除，旧 Renderer 数据不能重新覆盖；首次导入也尊重旧 owner 的 follow-catalog 墓碑和目标显式选择。兼容首帧缓存只能由成功 Host 提交单向更新，不是第二正本。remote viewer 仅监听 `theme` / `theme.familyId` 两项外观成功缓存，不捕获其它 legacy 偏好、不读完整 profile、不写入或导入；语言继续沿既有专用通知同步。
- **待迁移**：未能证明全新且尚未完成导入的旧 profile/owner 数据返回 `migrationPending`；只有有依据的新 profile 才解释为默认。inspection 不执行导入、不删旧键；完成初始化后，即使没有 Renderer 窗口也能从 Host 读取。
- **运行态消费**：桌面通知最终发送入口和窗口创建期点击行为直接消费已就绪的 Host 值，迟到的旧 Renderer payload 不能覆盖正本。Agent Island 仅在既有受支持初始化分支订阅偏好，应用前检查已提交身份与切换边界；登出/reset 后暂停自动应用，待合法会话的原有启用入口恢复。headless/不支持的平台不因保存的开关启动原生岛，退出时解绑订阅。

### 共用校验与纯读取边界

外观工具 grammar 与持久 store 使用同一严格字段 validator；原 UI 仍先执行原有 clamp/round，再经过最终持久校验。通用 override writer 只对显式配置了 validator 的领域增加最终闸门，不顺带收紧其它 legacy store。inspection 使用有字节上限、拒绝文件软链接的读取 helper，仅 `ENOENT` 按缺失解释；坏文件、权限错误和超限不删除、不修复。新任务默认值与个性化文件通过已提交 owner 和当前 profile 纯定位，不经过会加载或迁移登录态的 getter。

## Skill 与跨端快照

`cindy-settings` 是 Host-owned 静态 Skill，只负责语义引导，权限裁决仍由代码执行。内容不得包含用户偏好、秘密或个性化正文；当前 Agent 的启动快照不强制热更新。

源文件随 Host 静态打包，在调用时解析当前 profile / managed home，受既有 `cindy-settings` 单名称 mutation lease 保护。稳定物理源位于当前 userData 的 `host-settings-skills/cindy-settings`，仅物化 canonical `.agents/skills/cindy-settings` 与实际 Claude config 下的同名单 entry；不增加整库同步，不修改进程 HOME。Pilot 激活晚于模块导入时仍使用 Pilot 私有目录；开发版 Claude 的 `claude-home` 也使用其实际配置入口。

ownership marker 记录版本、内容摘要和目录/文件/link 身份。只升级确认归本 Host 所有且内容未变的源；升级前复验、预记待发布 inode，再原子发布内容，marker 更新中断时可凭预记身份恢复。升级保留物理源目录，因此停用偏好不随版本升级丢失。用户同名目录、文件、外部/断链 symlink、未登记或替换的实体全部保留；冲突时不另开 explicit path 绕过。首次创建或 link 发布中断而未留下可验证 ownership 时保守报冲突，不按名称或相同内容接管。

Claude 走实际 config 单 entry 与原生 `skillOverrides`；Codex 复用既有 `xdt-agents` root bridge，以真实 `skills/list` 为准，并在 Host 内容/入口变化时刷新目录；Pi 在本地普通任务启动时只给已启用的精确入口追加 `--skill`，禁用仍走既有 exclusions。管理扫描只补读这个精确 entry，不扫描额外根目录；SSH 不注入控制端 Skill。停用/重新启用沿既有物理路径身份处理，运行中任务不强制热刷新。

普通卸载保护只匹配通过 ownership 验证的精确 Host 源，不按 `cindy-settings` 名称封禁用户自有 Skill，也不借用插件 ownership 阻断停用。

只读快照传输保持有时效的白名单报告，不承担设置写入。能力 GET 确认后使用 v2，旧端明确 404 或明确仅支持 v1 时保留四域降级。v1 仍为 8 KiB，v2 为 128 KiB（固定 96 KiB / 动态 24 KiB / envelope 8 KiB），fresh TTL 仍为 180 秒；完整协商形状和版本兼容见 [云设置脱敏快照](./cloud-settings-snapshot.md)。

正常每 60 秒加最多 6 秒抖动采样。原四域、此次新增 profile 桌面正本和 owner 模型偏好已有即时变更通知，可触发 750ms 去抖重采样，但仍受最短 10 秒间隔限制。其它领域没有现成事件时由周期采样覆盖，不为只读展示新增文件 watcher，也不承诺所有设置实时刷新。

## 验证范围与发布边界

自动化测试必须使用临时 HOME/profile、无效测试身份、内存权限 fixture 或本地独立服务，不得读取开发者真实授权、Electron userData 或系统钥匙串。Claude native 还需显式设置 `CLAUDE_CODE_TMPDIR`，不能只靠 `TMPDIR` 隔离其临时缓存。macOS 的 Unix socket 路径长度有限，隔离临时根须足够短，避免地址截断碰撞；不能为解决路径问题改回真实 HOME。确认回调 fixture 不等于真人点击验证，磁盘发现不等于三个 native runtime 均已加载。

### 首版门禁历史

以下保留首版已记录的事实，不代表本次全量只读扩展重新执行了这些门禁。

2026-09-19 本地门禁记录：`pnpm test:unit:related` 自动选择全量单测计划，29 个执行 workspace 全部通过，另有 6 个无可收集测试的 workspace 按原清单标记不适用；Desktop typecheck、maker-core 与 device-link build 通过。`@cindy/mcps` build 仍有 9 条、maker-shared 类型检查仍有 8 条错误，使用内存 CompilerHost 与所选 HEAD 对照确认诊断完全一致，本轮没有修这些存量问题或放宽门禁；不能据此声称所有包构建已通过。

- Claude Skill 的原生初始化测试验证发现、停用、升级后保持停用与重新启用；Codex/Pi 当前只有发现/RPC/启动配置接缝验证，没有真实 native 加载证据。
- `claudeSettingsProvenance.native.test.ts` 使用捆绑 CLI、真实 SDK/MCP 与本地假模型，由真实 `Agent` 创建子代理，验证 Ask 和 Full Access 的逐调用拦截。通过 `CINDY_CLAUDE_SETTINGS_PROVENANCE_NATIVE=1 pnpm --filter desktop exec vitest run src/main/host-settings/__tests__/claudeSettingsProvenance.native.test.ts --maxWorkers=1` 显式运行；默认跳过。它不替代完整 Desktop adapter 接线测试。Auto 的真实审批模型链不由假服务仿造，当前仅覆盖 SDK options 接缝，不声称 native Auto 已通过。
- Codex/Pi 来源回归使用真实 loopback HTTP、helper 分派与生产设置 resolver，覆盖缺 threadId、双顺序混合 batch、过期 instance 和丢失远端字段等拒绝路径；没有运行真实 native Codex/Pi 或 SSH daemon，也不证明 native 模型会产生这些构造报文。
- 本轮全量检查曾暴露旧认证 fixture 未隔离新增 Skill 准备入口，误建两条指向测试目录的全局链接；已核对 ownership、内容指纹及文件身份后仅撤销本任务链接，并修复 fixture 的准备函数 mock 与临时 HOME。不能将早期测试描述为完全没有真实 HOME 副作用。
- 真实云实例、Electron 双窗口/device-link 真人确认、Windows native、真实模型缓存率与性能尚未验收；本地 fixture 和假模型结果不替代这些证据。

### 本次全量只读扩展的定向证据

- 收口后 Host 设置目录与三份 shared 目录/协议/coverage 测试合跑：**28 个文件、685 项通过**，另有一份 opt-in native 文件的两项按默认配置跳过。下列 92 项已包含在这 685 项中，不重复累计；此轮没有重新执行那两项 native 子代理来源验证。
- 客户端 `settingsSnapshotV2.test.ts`、`settingsReadCatalog.test.ts`、`settingsSnapshotCoverageRuntime.test.ts` 合跑 **92/92**：其中 wire/corpus/预算 78 项、独立目录锚点 9 项、生产 reader 接缝 5 项。5 项 coverage 已包含在 92 项中，不重复累计。
- coverage 在临时空 profile 上运行真实 core/interaction/collections 和显式注入的四域/profile preference 读取接口，经生产聚合、投影和 strict schema 验证三平台全部 453 固定字段、15 动态类接线；另用合法持久 fixture 验证每类动态明细与来源，禁止用恒定 unavailable 或默认值补缺口。它不等同真实 Electron 窗口或端到端验收。
- CIS 本地契约定向 **78/78** 通过，两仓 54 个逐值兼容 corpus 一致；最大合法结构报告均为 **93,853 bytes**（固定 69,133、动态 24,562、envelope 158），满足 128 KiB 分区预算且未丢固定叶子。Zod 3/4 的数组最大形状均实际展开验证。
- 这些定向测试使用任务隔离的短路径 HOME/profile 和专属测试数据库，不读开发者真实凭据；它们不改写上方首版曾发生真实 HOME 副作用的历史记录。定向项与下方完整单测有重叠，不相加为独立测试总数。

### 本次最终回归结果

2026-09-19 在两份任务隔离工作树完成以下检查：

| 检查 | 实际结果 |
| --- | --- |
| 客户端根 `pnpm test:unit:related` | 29 个执行 workspace 全部通过，测试调度器通过；另有 6 个 workspace 按既有清单标记无可收集测试，不计为已执行 |
| Desktop / Mobile `typecheck` | 两者均通过 |
| maker-core / device-link `build` | 两者均通过 |
| maker-shared / `@cindy/mcps` `build` | 分别仍有 8 / 9 条类型错误；与所选 HEAD 的基线一致，未扩修，不能宣称所有包构建全绿 |
| 多语言、术语、设计颜色与界面清单门禁 | 均通过；既有翻译与术语警告仍保留，不代表零警告 |
| CIS `typecheck` / `test` / `build` | 均通过；完整单测 1085 项通过，默认跳过的 17 项浏览器测试另行显式执行并通过 |
| 两端 `git diff --check` | 均通过 |

Mobile 测试使用与 Desktop 生产门面相同的纯 `createModelVisibilityMirror`，注入有类型的 Host 快照与通知；Desktop 静态薄适配器仍连接真实 Host store。测试不再导入完整 Main/owner claim 类型图，也不恢复旧 Renderer setter 的写权限。原超时、短重试、耗尽与恢复断言保留；此次发现的 Mobile 运行失败及类型污染已修复，不能混作上述 17 条基线错误。

CIS 浏览器证据是本地合成身份下的真实 TLS、专属 PostgreSQL 与独立 Chromium，覆盖四语、双主题和窄屏/桌面，不是原云实例或真人验收。32 张截图已保留，但工具通道无法回读图像，未完成视觉目检。两项 opt-in native 子代理测试此轮没有重跑；其他真实云、真人远控及跨平台原生验收边界仍按上文记录。

原六处 checkout 的分支、HEAD、index、完整工作区状态和 324 个既有改动路径摘要均与执行前一致。任务专属数据库容器及匿名卷已回收；日志、截图和隔离临时 HOME 保留，不能称全部临时资源均已清理。两份实现保留在任务工作树，没有提交、推送或部署。

本轮不更改真实 endpoint manifest、不升级现有云实例、不提交或部署。未来发布还必须核对旧 profile 摘要、真实运行时版本，以及 CIS 第七条 migration 的兼容旧业务基座；不能把本地演练当作线上发布批准。

## 网页直接编辑

网页复用 `HostSettingsService` 与现有文件 writer；新增的 `webTransport.ts` / `webRuntime.ts` 只负责 HTTPS 收发、当前身份与执行期限校验。只在 cloud resource-v1 Host 启动，从冻结 manifest 读取明确的 CIS 端点；不启动新窗口、不复制客户端设置布局引擎。

CIS 按实例 allowlist 开启，网页使用已有 HttpOnly 登录会话与 Origin 校验。Host 使用已登录设备 Access Token；两者不能互换。每次 read 发行的 operationId 绑定当前浏览器会话，真实保存与 agent/native UI 共用身份、单领域校验、CAS 和文件锁。网页明确点击保存是独立可信入口；`confirmed` 不是 wire 字段，agent 工具仍需原生真人卡片。

只开放上文四个领域，模型选项来自 Host 已缓存的实际目录，不刷新授权。`effort:null` 是显式自动；clear 是跟随默认。prompt 普通查询只返回自定义状态，不能借网页读出旧正文。网页 UI 只发送脏字段，收到 saved 回执后重新读取值与 override 核对；恢复默认用 clear。保存但应用失败单独报告，冲突/结果未知保留草稿，不自动重写。

传输使用 read/readBatch/update/receipt 封闭命令；两仓 `settings-web` 本地实现同步检查。runtime 与 owner 变化中断旧请求，命令 30 秒到期且每个请求只执行一次；只重送同一回执，不重执行 mutation。HTTP 禁止重定向、Cookie 与缓存；命令/响应各有字节上限。CIS 中命令/回执加密且保留不超过 10 分钟，不记录正文。

批量初始化是既有网页通道的兼容扩展。Host 注册声明 `readBatch:true`，仅对已声明的 runtime 下发 `readBatch`；旧 CIS 严格 schema 返回 400 时重试一次不带可选字段的注册，其它错误不降级。应先升级 CIS，再升级指定 Host；旧 Host 与旧网页继续单领域读取，新网页在旧 Host 上也先缓冲后整体显示。

一次批量只接受 1–64 个唯一、已支持领域，执行原有本地 reader。结果 `{ok:true,entries:[{domain,result}],remainingDomains}` 保留每个领域原来的错误/值/CAS；不包含写回执或原 prompt 正文。CIS 验证结果前缀与剩余后缀恰好覆盖原请求。总回执仍受 64 KiB（预留 512 字节 envelope）限制，按实际 UTF-8 字节在完整领域边界分包；单领域已超限显式报错，不截断列表。局部读取耗时达 5 秒也在领域边界分页，让剩余领域获得新请求期限。

每次读取前后仍核对身份、runtime 和期限；批量是减少传输往返，不是跨文件原子快照，保存时按每项独立 revision 再校验。CIS 复用原租约/加密队列，无新增数据迁移。前端先固定完整导航，再收齐所有分页后同步展示表单；单项失败仍可独立重新读取。关闭、身份失效或整批失败丢弃暂存数据，不恢复迟到表单。单领域保存、清除 override、会话确认与远程授权 v3 都不变。

这些网页适配文件无需客户端页面重写。分支里先前为全量只读目录引入的额外 profile/owner 偏好迁移属于另一组改动，不能据此将整个分支称为“客户端小改动”；发布范围需分别审查。

### 客户端完整目录到云端可用配置

`settingsCloudCoverage.ts` 与 `settingsCloudCoverage.test.ts` 按实际客户端目录逐项核对：453 个固定叶子中 190 个映射到可编辑配置，253 个属于目标 Linux 云环境不适用的硬件/平台/未消费字段，10 个保留专用入口。15 个集合有 14 个对应编辑领域，模型参数历史由实际选择派生；26 个账号、内容、授权和维护项目保留各自入口。这是目录映射，不能当作真实 Host 已全部可用或已上线的证据。

新增配置覆盖协作与命令资源、Git 快照、记忆与压缩、辅助/子代理/视觉/伙伴模型、模型显示/收藏/上下文/准入/名称/参考价格、八类 IM 默认值、Telegram 人设和群参与、官方 IM 默认工作目录与通知、IM 工作区模型及来源、插件能力与 Agent 偏好、工具开关、快捷键、桌面布局/语言/通知、浏览器后端、隐私与诊断。每域使用原生 store，保留未修改的配置和未知扩展字段。

- 工作区工具支持原六个普通工具以及浏览器。先读取 `workspaceTools` 取得 Host 已知的工作区列表，再在 read/update 中携带 `workspaceId`（工具参数为 `workspace_id`）。该标识不是路径，不能指定未知目录；revision 同时绑定工作区与当前继承的全局默认值。确认卡显示工作区名称。修改只影响后续使用该工作区的任务。
- IM 工作区模型和来源分开保存到它们各自的原生配置文件；每次只编辑一个领域。重置偏好保留 native mirror 所需的代次、dirty 标记和删除墓碑，不直接删除同步状态。
- 插件/模型列表只使用当前真实选择项；保留已保存但暂不可用的选择，改动时重新检查连接和模型能力。单字段目录选项超过 512 项或响应总量超过 64 KiB 上限时明确失败，不把截断结果称为完整目录。
- 网页保持 en、zh-CN、zh-TW、ja、ko 五语与双主题。未升级 Host 仍使用原四领域布局；新 Host 按客户端设置分类展示扩展领域，未知或不适用的能力不显示编辑控件。
- 远程授权 v3 的身份绑定、签名和专用 IPC 保持原实现；普通配置不会接收 Token，也不会借修改权限档跳过真人设置确认。

目标云环境的硬件与连接可用性须在部署/验收时重新检查。桌面语音、物理控制器、iOS/Agent Island、桌面更新器不等同于云实例配置；个人浏览器资料复制、ADB 设置、远程控制同意、IM 绑定与账号凭据保留原生专用流程。

模型目录容量修正只扩充只读 choices，每字段最多 512 项，已保存 override 数量上限不变；总响应仍受 64 KiB 预算约束。CIS 先升级 validator，再升级目标 Host；旧 Host 的不超过 256 项响应仍兼容，新 Host 不向旧 CIS 发送扩大后的目录。远程授权 v3 与确认语义不变。
