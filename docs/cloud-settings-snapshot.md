# 云实例设置快照

## 能力与边界

Host 是设置唯一权威。网页只读取 CIS 保存的最近一份脱敏快照，不连接 Host 实时查询，不下发设置，不输入凭据，不创建离线修改队列。设置保存成功不依赖上报成功。

本页记录客户端读取、投影、上报和兼容合同，不代表已部署到现有实例。会话修改仍只开放 `HOST_SETTINGS_DOMAINS` 的原四域并经过 Host 真人确认；新增只读目录不增加工具写权限。CIS 保存快照也不代表当前任务或窗口已成功应用配置。

### 全量目录的范围

客户端 `apps/desktop/src/shared/settingsReadCatalog.ts` 登记固定字段、动态配置和外部项目，CIS 维护同值本地目录；不跨仓 import，不把静态标题、翻译、范围、单位、源路径或控件元数据随报告上传。

| 类别 | 数量 | 展示边界 |
| --- | --- | --- |
| 实际设置分区 | 18 | general、personalization、providers、billing、usage、voice-input、im-bot、shortcuts、agent-island、import、remote-control、ghosts、builtin-tools、computer-use、cindy-make、storage、help、about |
| 固定叶子 | 453 | 每个稳定 ID 必须有读取值与来源，或明确状态；不能按容量丢弃 |
| 动态集合 | 15 | 明细有界，逐类保留读取范围、完整性、总量与省略量；未知总量明确标未知 |
| 外部项目 | 26 | 资源、动作、授权或外部入口的分类，不计入已读取 Host 设置值 |

固定叶子覆盖原四域、协作/资源/Git、记忆/压缩、子代理/辅助/伙伴模型链/视觉桥、通讯录、终端/窗口/远控/隐私、语音、browser/android/computer、IM、桌面和外设。覆盖锚点包括实际 18 tabs 及其嵌套控件、IM global + 七渠道共 96 个默认叶子、27 个快捷键定义、WorkLouder 两型号各七组及完整布局、gamepad 四类别各两组及全部按钮/摇杆、桌面 20 组展开的 25 个叶子。分类数量不等于成功读取数量；不适用平台的固定叶子也必须报告状态。

15 个封闭动态类是 `modelVisibility`、`modelEngines`、`modelFavorites`、`modelDisable`、`providerPresentation`、`modelContextBudget`、`modelPrices`、`modelParameterHistory`、`visionBridgeTargets`、`imWorkspacePrefs`、`telegramGroupActivation`、`builtinToolOverrides`、`pluginSidebar`、`pluginCindyPrefs`、`pluginErrandPrefs`。只读已知持久项，不扫描所有工作区，不刷新供应商目录或授权。已知工作区仅取已存在 Maker 的内存活跃本机会话，过滤远端和非法路径、去重，不构造 Maker 或调用磁盘会话枚举；该范围始终为部分范围。`imWorkspacePrefs.dirty` 表示本地写入尚未成功镜像同步，不是编辑器尚未保存。

账号资料、账单、内容库、安装资源、插件任意 `settingsHtml`、官方远端 Telegram 行为、授权和更新/清理/备份动作，保留真实归属与专用入口，不导出插件 KV/DOM/secrets，也不为展示执行动作。

## 正本、迁移与无副作用读取

- **Profile 正本**：主题/语言、sidebar/面板、通知、点击/发送/链接、淡入/推荐/导航条、Agent Island 和持久化网络调试等 20 组进入 `host-desktop-preferences.json`。自定义主题、声音和显示器信息留在 Host 本地。目录中的 `scope: profile` 表示归属，`surface: hostDesktop` 表示应用于执行 Host 桌面，不影响控制端或访问者网页。
- **Owner 正本**：模型显示、引擎偏好和收藏进入 `host-model-presentation-preferences.json`，保留初始化规则、follow-catalog 记录、收藏顺序/身份和 seed 墓碑；新任务默认值/参数历史及个性化沿用已接入的 owner store。原有各领域保持实际 owner/profile 归属，不为网页另存一套设置。
- **本机桥**：仅同一执行 Host/profile 的可信本地 Renderer 通过固定 preload/IPC 做一次性导入、CAS 保存和变更订阅。桌面与模型桥均校验可信顶层 frame、profile partition 及 Host 登记窗口的读写权限；写入只允许本机主、副应用窗口，提交前复验，remote viewer 明确排除，同步启动入口只读。控制端、remote Renderer、网页不能复制偏好到执行 Host。profile stamp/revision 与 owner/generation 分别保护对应正本。
- **初始化与缓存**：Host 已初始化或恢复默认后，旧 Renderer 数据不得覆盖；多窗口冲突只回读，不换 revision 重放旧表。Renderer 仅有可重建缓存，成功以 Host 回执为准；兼容首帧缓存只能由成功提交单向更新。不能证明全新且尚未导入的旧数据明确 `migrationPending`，不冒充默认值；初始化完成后无窗口也能读取。
- **Inspection**：`readSnapshot.ts` 调用窄的纯 inspection，复用领域真实类型、枚举、范围和默认解释；不调用会 ensure、修复、删除坏文件、执行迁移/claim、读凭据或探测权限的旧 getter，不联网或启动设备。读取保存事实不套用当前模型写入准入，也不把退役型号换成推荐值。
- **隔离**：单域错误与其他领域隔离；身份、代次或 profile 改变使整次采样失效，不拼接不同 owner 的数据，不承诺多文件全局事务。原生 UI clamp/round、工具严格拒绝和历史空/null grammar 不因只读 wire 放宽。

### 公开性与隐私

公开 model/provider ID 必须同时满足两项：由随包 `BUNDLED_CATALOG` 的**精确成员关系**证明公开性，再通过保守 wire 字符与长度校验。活动目录、组织发现、用户连接、前缀、别名和 regex 命中都不是公开性证明；读取不会为证明公开性刷新网络目录或授权。

v2 引用只能是 `{ configured: false }`、`{ configured: true }`，或有证据时的 `{ configured: true, publicId }`；ID 最长 96 字符，允许受限 ASCII 与有限层级的目录标识，拒绝 URL、路径和秘密前缀。自定义或无法证明公开的引用只显示是否配置。动态私有条目只使用快照内序号，不把内部 key、名称或稳定身份传出。v1 沿用更窄的旧 ID 语法，没有公开证明时省略 ID，不能为降级放松隐私。

**不上传**个性化/提示词正文、其摘要或 hash、Host revision、owner 标记、凭据、URL、文件路径、自由字体名、自定义命令文本、设备身份、Provider/MCP 配置、任务消息、操作正文或原始错误。原生读取结果不是 wire DTO，公开报告始终逐字段新建。企业微信通知偏好与加密凭据同存，当前只能报告 `private`，不为读取该开关解密秘密。

## 启用条件

仅 `--cloud-instance` 且认证协议为 `resource-v1` 时注册上报器。每次读取已提交的内存 owner，要求：

- 不处于账号切换边界；mode 为 `cloud`。
- owner、当前认证 membership 与实例固定 membership 一致。
- 当前 device 与实例固定 device 一致。
- `authManager.getAccessToken()` 返回现有的就绪 AT。上报器不读取、持有或刷新 RT。
- 当前认证 realm 的 endpoint manifest 明确提供 `cloudInstanceApiBaseUrl`。

该字段可缺省或为空：此时不上报、不采样、不猜 CIS 地址，也不影响启动。非空值必须为 HTTPS 且不能含用户名、密码、query 或 fragment；即使 dev 的 `allowHttp` 开启，也不接受该字段使用 HTTP。端点缓存仍受原有区域信任域限制，不增加跨区域例外。

例如受信任部署清单可提供 `"cloudInstanceApiBaseUrl": "https://cloud.example.invalid/cis"`，客户端追加固定路径 `/instances/self/settings-snapshot`。这是契约示例，不是可用部署地址。

旧清单仍解析为空字符串；旧客户端忽略未知字段。此纯增可选字段不提升 manifest schemaVersion。**非空非法配置仍按现有清单规则阻断启动，不静默降级。**

实例的 endpoint manifest 可能参与既有 profile 摘要。将来启用字段前须按已冻结的实例配置/维护流程核对摘要、目标 realm 和上游版本，不直接改原实例挂载或凭据。本次没有修改任何真实 manifest、登录迁移入口、Keyring 或运行中云实例，也不新增环境变量。

## 能力协商

新 Host 在采样上报前，以现成 AT 调用 Bearer-only `GET /instances/self/settings-snapshot/capabilities`。该入口无设置副作用，不接受网页 Cookie 或 Platform 凭证，仍受普通客户端身份/device、现有 admission 与 development gate 约束；响应不得缓存到共享缓存。

支持 v1 与 v2 的响应必须严格等于以下形状；能力文档的 `schemaVersion: 1` 不是设置报告版本：

```json
{
  "schemaVersion": 1,
  "supportedVersions": [1, 2],
  "limits": {
    "v1": { "maxBytes": 8192 },
    "v2": {
      "maxBytes": 131072,
      "fixedBytes": 98304,
      "collectionsBytes": 24576,
      "envelopeBytes": 8192,
      "collectionMaxBytes": 4096,
      "collectionMaxEntries": 32
    }
  }
}
```

另一种合法形状是 `{"schemaVersion":1,"supportedVersions":[1],"limits":{"v1":{"maxBytes":8192}}}`。对象全层 strict；版本必须是上述 `[1,2]` 或 `[1]`，不接受重复/未知版本、猜测字段或不匹配的上限。

- 合法 200 且含 v2 时发送 v2；合法 200 仅支持 v1 时发送 v1。
- **明确 404** 表示旧端没有能力入口，可降至 v1。401/403、超时、网络/服务失败或非法能力正文不能当成协商成功，不能随后猜测发送另一版本。
- 成功协商最多缓存 5 分钟，绑定当前身份/代次、realm、实例 device 与 endpoint；归属或端点变化立即废弃，下一轮重新协商。
- 旧 Host → 新 CIS 继续使用 v1；新 Host → 旧 CIS 仅保留四域，页面明确其余字段为旧版未包含。新旧报告整份替换，不把旧报告缺失叶子与上一份 v2 拼接。

## Wire v1：保留原合同

`POST /instances/self/settings-snapshot`，仅普通 Bearer。v1 原始 body 与序列化报告都保持最大 **8 KiB**，原 parser、四域 fixture、取值范围及导出不变，不能直接把 v2 叶子塞进 v1。

| 领域 | 可展示内容 | 作用范围及生效边界 |
| --- | --- | --- |
| `newTaskDefaults` | 引擎、有公共证据的来源/模型 ID、effort、fast、thinking、worktree、Plan 默认值 | 当前 owner；后续新任务 |
| `personalization` | 是否自定义 | 当前 owner；后续 Agent 启动 |
| `databaseWarning` | 提醒阈值、是否关闭 | 云 Host profile；即时 |
| `appearance` | UI/代码字号、窗口缩放、字体是否自定义 | 云实例自身桌面；不改变控制端或网页 |

Envelope 仍是 `schemaVersion: 1`、UUID `reportId`、已确认的 CIS 独立水位 `baseRevision`、本次采样时间 `capturedAtMs` 和四域 `domains`。所有对象拒绝未知字段。旧 ID 最长 96 字符，只允许保守的字母数字、点、下划线、连字符，拒绝秘密/URL 前缀和路径。

v1 保留 `default` / `override` 来源；显式设置为 false 或等于默认值仍可为 override。不可读领域降为旧版 `unavailable`，不伪造默认值；ID 无公共证据、不满足旧语法、为空或未确定时省略，effort 未确定或不受旧协议支持时也省略。v2 更精细的状态不会反向改变 v1 grammar。

## Wire v2：全字段严格报告

Envelope 为 `schemaVersion: 2`、UUID `reportId`、非负安全整数 `baseRevision` / `capturedAtMs`、必需的 `fields` 和 `collections`。`fields` 必须恰好包含 453 个稳定 ID，`collections` 必须恰好包含 15 个封闭类名；没有任意 `record<string, unknown>` 或自由字符串扩展口。

每个固定字段是以下两类之一，全层拒绝多余键：

- `{ status: 'value', value, source: 'default' | 'override' | 'unknown' }`：`value` 使用该稳定 ID 对应的安全类型，不是通用 JSON。
- `{ status: 'unavailable' | 'unreadable' | 'unsupported' | 'migrationPending' | 'private' }`：不得附带 value 或伪造来源。

`unavailable` 是暂时不能取得事实；`unreadable` 是读取/校验失败；`unsupported` 是平台等不适用；`migrationPending` 是尚未完成原生迁移；`private` 是不应公开。没有来源证据用 unknown，不能按值是否等于默认推断。v2 原四域数值与 Host 对齐，例如数据库阈值 1–1024 GiB、UI 字号整数 12–24、代码字号整数 10–24、缩放 0.5–3；不改变 v1 既有范围。

### 动态完整性

每类集合包含 `status`、`total`、`omitted`、`entries`。条目按类使用固定 typed leaves，另有正整数 `ordinal` 和来源；序号严格递增，只对本份快照有意义。

模型显示集合只展示已保存的显式 override；初始化时缓存的旧目录默认值不能充当当前有效值，未被显式覆盖的历史默认/follow-catalog 路由计入已知保存范围的省略量，不宣称遍历了当前全部可用模型。参数历史中 provider memory 与 lastByVendor 是独立槽，同路由也分别保留；合法空 effort 按未指定省略该叶子，不丢弃其它调档或整个集合。旧工作区删除墓碑的缺省 dirty 复用领域原有解释。

- `complete`：总量已知，`total === entries.length`，`omitted === 0`。
- 已知总量的 `partial`：`omitted === total - entries.length` 且大于 0；不能把部分明细标全量。
- 未知总量的 `partial`：`total: null`、`omitted: null`，例如未遍历所有 project 范围的工具偏好；已读取条目仍可展示。
- 不可读/不可用/不适用/待迁移/隐私状态：`total: null`、`omitted: null`、`entries: []`，不把失败显示为零条配置。

预算分配先保留每类摘要，再按稳定目录顺序轮转加入第 1、2、…条明细；被容量阻断的集合不跳过中间项。输入非法条目、虚假完整性、重复序号或非法尾项直接拒绝，不能通过裁掉错误项“修复”报告。

### UTF-8 预算

| 层级 | 上限 |
| --- | --- |
| v1 原始 body / 报告 | 8 KiB（8192 bytes） |
| v2 原始 body / 报告 | 128 KiB（131072 bytes） |
| v2 全部固定字段 | 96 KiB（98304 bytes） |
| v2 全部动态集合（含摘要） | 24 KiB（24576 bytes） |
| v2 envelope 与余量 | 8 KiB（8192 bytes） |
| 每类动态集合 | 最多 32 条、4 KiB（4096 bytes，含摘要） |

按 `JSON.stringify` 后实际 UTF-8 字节计算，不使用 JS 字符数；原始 HTTP body 另按版本限额，空白等不能绕过。只有快照 POST 使用版本化请求上限，其他 HTTP 路由仍保留原 8 KiB 限额。Host、HTTP、store 对已选版本一致校验，未知版本拒绝。不得截字符串或删除固定叶子腾空间。

命名预算入口为 `settingsSnapshotMaxBytesForVersion`、`settingsSnapshotUtf8Bytes`、`validateSettingsSnapshotBudget` 与 `boundSettingsSnapshotCollections`；两仓本地 `settingsSnapshotAnyReportSchema` 验证 `v1 | v2`，共享同值有效/无效 corpus，不共用跨仓运行时。

## 回执、transport 与生命周期

成功返回 `{ revision, receivedAtMs, expiresAtMs }`。revision 独立于实例生命周期版本。服务端拒绝 180 秒以前或超过未来 30 秒的采样；自接收起最多 180 秒 fresh。相同 `reportId` / 相同正文的重试不续 TTL，不同正文拒绝。

- 409 `SETTINGS_SNAPSHOT_REVISION_CONFLICT`：读取 `error.currentRevision`，下次重新采样，以新 reportId 提交，不复用旧正文。
- 429：尊重 `Retry-After`，客户端退避至少 10 秒、最多 600 秒。
- 其它错误：不输出原始响应、URL、token 或设置正文；不影响设置保存与任务运行。

窄 transport 仅允许固定能力 GET 和快照 POST，均设置 `redirect: 'error'`、`credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`cache: 'no-store'`。一轮请求超时 8 秒，响应流最多读取 4 KiB；不自动刷新身份、不跟随重定向。

启动就绪并完成协商后采样；正常每 **60 秒加最多 6 秒抖动**重新读取。原四域、此次迁入 Host 的 profile 桌面偏好与 owner 模型偏好有现成变更通知，触发 750ms 去抖；身份变化也会请求新一轮采样。其他领域无现成事件时由周期采样覆盖，**不新增文件 watcher、不承诺全部设置即时同步**。新请求至少间隔 10 秒，CIS 另以数据库原子限流兜底。只有一个进行中请求，变化只留下“再采样”意图，不保存旧快照队列。

owner generation、owner、realm、device 或 endpoint 变化会丢弃旧水位/能力缓存并取消旧请求；旧身份晚到回执不能更新新身份状态。读取阶段也复验捕获的 owner/profile 上下文。退出时取消请求、计时器和订阅。

CIS stop/wake/归属变化推进独立水位并清正文，唤醒等待新上报；清理过期正文不能重置水位。

## 网页只读展示

CIS 从静态目录和已验证快照产生带版本的展示模型及运行时响应校验；浏览器负责分组、折叠、搜索和显示，不另定义字段范围、模型/来源 regex 或 harness/effort 业务准入。不渲染未知键、原始 JSON 或原错误，保留响应形状防御与 `textContent`。

目录和值分开：未上报、旧版未包含、过期、待迁移、不可读、不适用和隐私不公开明确区分；动态类展示 partial/omitted/未知总量。外部入口不装成已读取配置。四语为中文、英文、日文、韩文，沿用网页 Light/Dark 与窄屏布局；云 Host 外观/语言仅作为数据展示，不改变访问者浏览器。

详情可见时每 30 秒 GET。非 fresh、关闭/隐藏、退出、401、切实例、过期或请求失败清除实例值和来源，可以保留静态目录；abort/epoch 隔离迟到响应，403/404 停止自动刷新。设置详情不会创建、唤醒、登录实例或写设置；这不把管理主页已有生命周期操作宣传成“全站只读”。

## 验证与发布限制

### 首版历史证据

以下保留首版记录，不代表本次扩展重新运行了这些验收：

客户端定向测试覆盖 `snapshotProjection`、`snapshotPublisher`、`snapshotRuntime`、endpoint parser 与缓存；用临时身份和独立 profile，不读取开发者 HOME 或凭据。

本地跨端验收使用两个独立进程：客户端只加载客户端投影与 transport，服务端只加载 CIS fixture，通过真实 loopback TLS 连接独立 PostgreSQL；浏览器使用新的临时 Chromium context。其认证为 fixture，不等同真实 Auth、Pod 或原云实例线上验收，也不证明生产数据规模下的迁移锁耗时。

首版全量门禁及曾发生的测试 HOME 副作用保留在 [Host 设置与会话入口](./host-settings.md#首版门禁历史)，不能用本次隔离测试结果覆盖这些历史事实。

### 本次字段目录与 v2 定向证据

- 客户端三个测试文件合跑 **92/92**：`settingsSnapshotV2.test.ts` 78 项，`settingsReadCatalog.test.ts` 9 项，`settingsSnapshotCoverageRuntime.test.ts` 5 项；coverage 已包含在 92 项中。
- 5 项生产 reader coverage 实跑三平台空临时 profile，验证 453 固定字段与 15 动态类都有真实接线；core/interaction/collections 使用实际 inspection，四域/profile preferences 使用显式可控 DI，经生产聚合和投影再做 strict schema 校验。合法持久 fixture 为每个动态类提供明细，无恒定 unavailable 补位、无 schema 漂移降级；不代表真实 Electron 窗口验收。
- CIS 对应 wire/corpus/预算测试 **78/78**；两仓 54 个逐值 corpus 的 SHA-256 同为 `7efb2c76d633a32d3171e980a3253477146fed9a550918c25f9b654c687b3d07`，包含 v1 8192/8193、v2 131072/131073 原始 body 边界、未知字段、私密内容、来源/状态和集合完整性。
- 两仓最大合法结构均为 **93,853 bytes**：固定 69,133、动态 24,562、envelope 158；453 固定叶子全部有值，Zod 3/4 都展开最大数组和有界分支，未丢固定项。另验证每集合 4 KiB、总动态 24 KiB、32 条上限以及数值序列化余量。
- CIS 完整单测 **1085/1085** 通过，typecheck 与 build 通过；默认套件中的 17 项浏览器测试为 opt-in，另行显式运行并全部通过，不把默认跳过记成已执行。
- opt-in 矩阵使用真实 loopback TLS、专属 PostgreSQL 与独立 Chromium profile，覆盖四语 × Light/Dark × 320/1280 宽度，以及搜索、部分列表、失效清值、迟到响应、401/403/404 和本地过期；设置详情期间的请求均为 GET。身份、报告及实例是本地合成 fixture，不是原云实例、真实 Auth 或真人验收。
- 生成 32 张页面/搜索截图；当前工具通道不能回读图像，**未完成视觉目检**，不能用 DOM/溢出断言代替。专属测试数据库容器及匿名卷已按精确身份回收，截图和日志保留。
- 客户端最终 `pnpm test:unit:related` 的 29 个执行 workspace 全部通过，另有 6 个无可收集测试的 workspace 按既有清单标记不适用；Desktop 与 Mobile `typecheck` 均通过，多语言及设计门禁通过。Mobile 测试复用纯 mirror factory 与有类型的 Host 快照/通知，不导入 Desktop Main 类型图，不恢复旧镜像写权限。
- maker-core、device-link `build` 通过；maker-shared 与 `@cindy/mcps` 仍分别有 8、9 条与所选 HEAD 一致的基线类型错误，未扩修。完整结果及验证范围见 [本次最终回归结果](./host-settings.md#本次最终回归结果)，不能宣称所有包构建全绿。
- 两端补丁格式检查通过；原六处 checkout 的分支、HEAD、index、完整状态及 324 个既有改动路径摘要均保持不变。专属数据库已回收，日志、截图和隔离临时 HOME 保留。上述定向与完整单测有重叠，不累计为独立总数；本轮未提交、推送、修改真实 endpoint manifest 或部署，也不声称真实云实例与真人验收已完成。

### 发布前置仍然独立

首版 CIS 新增第七条 migration；本次 v2 沿用现有 JSONB 表与第七条 migration/trigger，不新增列或回填、不改写历史 migration。原六条历史的旧镜像在第七条应用后可能被自己的 migration guard 拒绝启动；未来发布仍必须先准备并验证“旧业务 + 认识第七条的 guard”兼容基座，不能把旧镜像直接回滚当作保障。

启用 v2 还须服务端先具备版本支持。只识 v1 的旧服务不能被声称能解释已保存的 v2，降级期间应隐藏不能解释的快照，不改旧报告凑兼容。具体数据库发布边界见服务端 `docs/cloud-instance-server.md`。

56 系网页 Cookie 仍是固定 30 分钟 claims-only 会话；快照 180 秒 TTL **不等于** Auth 全局退出的即时撤销。本功能不增加新的网页登录桥。本次不修改真实 endpoint manifest、不升级现有实例、不提交或部署。


### Optional cloud settings management operations

The private cloud web transport may advertise `managementV1` separately from the frozen v3
settings contract. The browser receives session-bound action tickets for bots, model providers,
custom MCP, contacts and memory contents. Only the compiled Main service adapters may execute
these actions; browser input cannot specify an IPC channel or read stored credentials. Existing
Electron renderer trust checks remain in place for ordinary IPC calls.

OAuth uses native services, PKCE/state validation, mutation queues and owner-scoped storage.
Only presentation is redirected to the initiating browser. Forwarded callback URLs must match
the exact loopback listener and state created by that login. Cancellation closes only resources
captured by that invocation. Secrets are write-only, are never included in ordinary settings
snapshots, and raw native errors are not returned to the web. Lost replies query the operation;
no automatic mutation retry is permitted. Restarted or cancelled operations may remain unknown.

The capability runs only on the authenticated cloud instance transport. It does not add a
renderer API, Device Link channel or general remote-control endpoint. Existing native connection
and content services retain storage ownership; no database migration is introduced by this feature.
