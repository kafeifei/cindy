# 完整镜像构建缓存与交付实测

2026-10-23（北京时间），`0.1.113-cloud.21` 在全新 fork 专属 ECI runner 上完成自动交付：
**原始 push → ACS Ready 17 分 47 秒，全部 job 收尾 17 分 58 秒**。包含供给、排队、
完整构建、原生 smoke、发布与缓存等待；没有人工重试，也没有重置计时起点。
依赖准备层延续此前命中，新增 Electron 原生缓存首次跨 runner 复用，构建缓存和镜像上传
均实际走同仓 VPC 端点。本次热缓存交付达到 20 分钟目标，不是冷构建耗时或每轮性能保证。

## 连续复测：cloud.22 / cloud.23

两轮均从新 runner 自动执行，只有版本号变化，无人工重试。以下计时从原始 push 开始：

| 指标 | [cloud.22](https://github.com/zhuoshaojian/cindy/actions/runs/39889100535) | [cloud.23](https://github.com/zhuoshaojian/cindy/actions/runs/39891027932) |
| --- | ---: | ---: |
| push → ACS Ready | 19 分 41 秒 | 20 分 23 秒 |
| push → 全部 job 收尾 | 19 分 51 秒 | 20 分 36 秒 |
| 完整构建 | 459 秒 | 457 秒 |
| 发布 | 121 秒 | 123 秒 |
| ACS 准备 | 268 秒 | 267 秒 |
| 原生缓存恢复/校验 | 3.8 秒 | 3.8 秒 |

**连续低于 20 分钟尚未通过**。两轮依赖/原生缓存、桌面 smoke、五份记录哈希、公开双标签
与 ACS 2/2 Ready 均通过。六个 ECI Pod 的事件均为 `SuccessfulHitImageCache`；
从 serverless provisioning 事件到容器启动分别约 13–20 秒，不是冷拉工具镜像。
第二轮增加约 44 秒来自检查、job 收尾和队列衔接等累计波动，不能归因于发布骤慢。

下一轮保持构建图和凭据边界，缩小 verify 的真实源码检出范围，并并行读取发布前
四个端点/标签。所有查询完成且通过才允许写标签；增加只含操作类型和秒数的发布计时。
检出裁剪在独立目录执行相同 Node/Python 集合，没有降低测试覆盖；结果待真实交付复测。

## 已完成热交付：cloud.21

[39838127957](https://github.com/zhuoshaojian/cindy/actions/runs/39838127957)，配方
`6c67ba213ea837907c0030e07e7632616d883e2b`，相对 cloud.20 **只递增版本号**。
原始 push 为 2026-10-22 19:12:53.861936 UTC，ACS 步骤完成于 19:30:41，最后 job
完成于 19:30:52。三个 job 和三个构建阶段都只有一次成功尝试。

| 阶段 | cloud.18：未缓存原生编译 | cloud.20：原生缓存首次成功填充 | cloud.21：全新 runner 热测 |
| --- | ---: | ---: | ---: |
| 准备文件系统恢复 | 93.6 秒 | 91.0 秒 | 77.7 秒 |
| 原生预编 | 打包时重编 | 102.7 秒 | 缓存复用，未执行 |
| 应用编译与打包 | 292.6 秒 | 205.2 秒 | 164.8 秒 |
| 其中：打包副本原生缓存恢复/校验 | 无 | 3.7 秒 | 3.1 秒 |
| 完整 Dockerfile 构建 | 8 分 57 秒 | 9 分 11 秒 | 6 分 16 秒 |
| 发布镜像 | 121 秒 | 123 秒 | 104 秒 |
| ACS 准备步骤 | 236 秒 | 237 秒 | 236 秒 |
| 原始 push → ACS Ready | 20 分 35 秒 | 20 分 56 秒 | **17 分 47 秒** |
| 原始 push → 全部 job 收尾 | 20 分 45 秒 | 21 分 06 秒 | **17 分 58 秒** |

缓存层实际下载/解压后执行断网读取检查（8.7 秒），不能把元数据 `CACHED` 当作文件恢复完成。
`prepare/materialize/full-build` 三份日志均无依赖安装或原生预编输出；恢复时原生层显示
`DONE 77.7s` 是文件下载/解压，不是编译命令重新执行。2.09 GB 层的 VPC 下载为 23.5 秒。
新版本应用仍重新编译，最终包二进制核对后再运行 SQLite 查询和 PTY shell，
`electronVersion=42.11.12`、`abi=146`，`passed/sqlite/pty` 全部为 true。

检查 job 55 秒，构建/验收/发布 job 573 秒，ACS job 269 秒；Actions 创建后
队列/供给/衔接共 177 秒。基座导出 57.3 秒、运行时导出 78.9 秒，与部分构建步骤有重叠，
不相加当作节省。相对 cloud.20 完整构建减少 175 秒，包含省去首次填充及本轮执行波动；
不把所有改善归因于缓存或 VPC。三个专属 runner 完成后自动回收。

统一 `cloud-runtime-cn` 保留两个不可变标签：`0.1.113-cloud.21-cn-amd64` 和
`sha-6c67ba213ea837907c0030e07e7632616d883e2b-cn-amd64`，匿名读回同一 manifest：
`sha256:caa4cdfa553c441a715ad069ed87902dfe4c82780553d2fbe804d35f380bd2a9`。
镜像仍为两层，压缩层合计 1,423,693,253 bytes；基座 image ID 与此前成功版本相同。

五份记录 SHA-256、最终 image ID 与原生 smoke 一致性、双标签/config、ACS 2/2 Ready 均通过。
最终 fused Cindy 的隔离 smoke 覆盖 Xfce/Plank、可见窗口、老 HOME 权限、UID 10001
renderer 沙箱、无网络、只读根和正常停机。构建期 SQLite/PTY 使用同版本原始 Electron，
没有开启正式包的 RunAsNode fuse。证据在 `cloud-candidate-39838127957-1` 和
`cloud-cache-39838127957-1` artifacts。

没有操作云实例、业务 PVC、CIS 准入或新认领配置；`releaseApproved=false`、
`podMatchVerified=false` 保留。此轮不包含真实 OAuth/DeviceLink 或业务 Pod 缓存命中验收。
纯文档提交不会创建交付运行或 runner；cloud.19 的首次接入失败继续保留在下文。

## cloud.15 历史基线与排队修复

历史基线 [cloud.15 / 39800845076](https://github.com/zhuoshaojian/cindy/actions/runs/39800845076)：
完整 Dockerfile 构建 **13 分 15 秒**，原始 push 到 ACS Ready **2 小时 3 分 18 秒**，
全部 job 收尾 **2 小时 3 分 29 秒**。运行创建到收尾中，三个 job 实际执行共 22 分 59 秒，
队列/供给/衔接共 100 分 23 秒；没有重置起点或取消重跑。排队期间发现并修复了自己的
控制器漏供给，不能全部归因于同期的
[GitHub Actions 降级](https://www.githubstatus.com/incidents/wq8305lppdc2)。
以下是包含网络、ECI 性能和调度波动的实测，不是性能保证。

### 排队瓶颈与恢复

前置检查运行 [39796621978](https://github.com/zhuoshaojian/cindy/actions/runs/39796621978)
有真实 `queued` job，但 workflow 保持 `pending`，带状态筛选的运行列表没有返回它。
旧控制器只扫描三个状态，既漏发现又不接受 `pending`，使后续 `cloud.15` 被并发队列阻塞。
现增加最近 100 次未筛选运行的补查，仍须真实 job 为 `queued` 且仓库、分支、head、
workflow、事件和独有标签全部匹配。没有 job 或仍在环境等待的运行不会创建 runner。

修复后，原前置检查自动获得 runner，于 16:27:36–16:28:41 UTC 成功执行并回收；
没有取消、重建或手动 dispatch 原运行。`cloud.15` 检查随后自动执行，构建 runner 于
16:31:12 UTC 开始监听、16:40:40 收到 job，分配等待 9 分 28 秒。该段已排除环境审批
和 runner 离线，单独记录，不与漏供给或 Docker 构建时间混算。

另修复启动超时误判：在线监听或忙碌的 runner 不因 job 读取仍为 `queued` 而在 15 分钟后
被重建；真正离线/失败才沿用有上限的补供给。原 Kubernetes Job deadline、取消回收、
凭据隔离和三次重试上限保留。两项修复只部署至 fork 专属控制器；针对真实入口的
最小回归先失败后通过，交付工具测试 50 项通过，文档检查 10 项通过。

## 无人介入复测 cloud.17

[39824047768](https://github.com/zhuoshaojian/cindy/actions/runs/39824047768)，配方
`df427c067e278e6441b0fd024cb0d5db0415dbdb`，首次 attempt 自动完成，无手工重试。
原始 push 17:35:23.917803 UTC，ACS 步骤结束 17:56:47，全部 job 17:56:57：
分别为 **21 分 23 秒 / 21 分 33 秒**，没有扣除任何等待。

- 准备、恢复、完整构建三份日志共同确认缓存命中，依赖安装输出为零；
  准备文件系统恢复 86.1 秒、断网读取 4.8 秒，编译 283.1 秒，完整 Dockerfile 518 秒。
- 检查 68 秒、构建/验收/发布 737 秒、ACS job 302 秒，队列/供给/衔接 181 秒。
  公网发布 125 秒、检查 checkout 48 秒是下一轮优化对象。
- `prepare/materialize/full-build-attempts.json` 均只有一次成功；自动网络重试已有单元回归，
  本轮没有发生对应网络故障，不能作为真实故障恢复验收。
- 原生隔离 smoke、公开双标签/config 读回、四份记录哈希及 ACS 2/2 Ready 均通过。
  发行和业务实例准入继续分开，业务实例、PVC、CIS 和新认领默认均未改动。

## VPC 上传 cloud.18 与原生缓存接入

[39827917054](https://github.com/zhuoshaojian/cindy/actions/runs/39827917054)，配方
`c590103106c8f3700983fb56d22eec7364e9f459`，push 18:02:32.939943 UTC，ACS 步骤结束
18:23:08，全部 job 18:23:18，分别 **20 分 35 秒 / 20 分 45 秒**，一次自动完成。

- 实际观察到 `docker push` 使用同仓 VPC 端点，公开双标签/config/digest 读回一致。
  发布 121 秒，对照 `cloud.17` 的 125 秒，改善有限，不能声称主要瓶颈已由 VPC 解决。
- 检查 job 的稀疏检出仍执行全部测试，checkout 32 秒（上一轮 48 秒）。
- 准备恢复 93.6 秒，断网读取 6.0 秒，应用编译 292.6 秒，完整构建 537 秒。
  隔离 smoke、五项桌面/停机检查、四份记录 SHA、ACS 2/2 Ready 通过；三个 runner 自动回收。
- 当时的重复项：每次云修订都会在打包副本上强制重编 `better-sqlite3` / `node-pty`。
  现使用锁定 `@electron/rebuild` 自带的源码/ABI 缓存，在独立物理副本预编，保留构建工具的 Node ABI。
  新阶段接在现有依赖准备层之后，继承原缓存；只有首次填充新增原生编译。
  准备层的 Docker 输入同时绑定 OS/编译器、锁文件、模块源码、Electron 版本与缓存脚本。
  每次仍重新打包应用、核对最终 `.node` 哈希及权限，并在断网构建步骤中用同版本 Electron
  实际执行 SQLite 查询与 PTY shell；发布记录绑定 `native-modules.json`。
  普通客户端、正式包 fuse 和业务实例均不改。首次填充与后续全新 runner 热测单独记录。

首次原生缓存填充 [39832742777](https://github.com/zhuoshaojian/cindy/actions/runs/39832742777)
在构建阶段失败，没有发布镜像，也未进入 ACS。锁定 `electron-rebuild 4.2.0` 在
`force=true` 时会关闭 `useCache`；修正为只删除打包副本的 `.forge-meta` 标记，
以 `force=false` 进入源码/ABI 缓存分支，并继续核对二进制哈希/权限。
该失败保留为新缓存接入记录，不计作成功的冷/热交付。

## 原生缓存首次成功填充：cloud.20

[39834348300](https://github.com/zhuoshaojian/cindy/actions/runs/39834348300)，配方
`909c9bd8cf6bbe9de5c926e718ad26c8b7029334`，由版本提交自动触发、首次 attempt 完成。
原始 push 为 2026-10-22 18:46:39.568320 UTC，ACS 步骤完成于 19:07:36，最后 job
完成于 19:07:46：**20 分 56 秒 / 21 分 06 秒**，包含首次原生缓存填充，仍超出目标。

- 原准备文件系统恢复 91.0 秒，无依赖安装输出；新增原生预编 102.7 秒，
  后续 materialize/full-build 均复用该层。此轮是原生缓存首次成功填充，不是全冷构建。
- 应用打包 205.2 秒（cloud.18 为 292.6 秒），其中原生模块缓存恢复和校验 3.7 秒。
  完整 Dockerfile 步骤 551 秒；不能把首次预编成本从完整交付中扣除。
- 构建期断网实测最终 ASAR 内 SQLite 查询和 PTY shell：
  `electronVersion=42.11.12`、`abi=146`，`passed/sqlite/pty` 全为 true。
  该检查使用同版本原始 Electron，正式 Cindy 的 RunAsNode fuse 仍关闭。
- 最终 fused Cindy 的原生隔离桌面 smoke 另行通过；五份记录哈希、公开双标签/config
  读回及 ACS 2/2 Ready 全通过。三个 job、全部构建阶段均一次完成，runner 自动回收。
- 发布使用同仓 VPC 配置，耗时 123 秒；检查 job 51 秒、构建/验收/发布 770 秒、
  ACS job 267 秒，队列/供给/衔接 173 秒。没有修改实例或 CIS 准入。

证据在 `cloud-candidate-39834348300-1` 与 `cloud-cache-39834348300-1` artifacts。
随后 `cloud.21` 只递增发行修订，保持准备层输入不变，在全新 runner 上验证了跨运行复用；
完整耗时见本文顶部，未用 cloud.20 内部后续步骤的命中代替。

## 缓存命中修复

- 基座在隔离 `/rootfs` 中先把较新的 mtime 限制为 `SOURCE_DATE_EPOCH`，应用层组装后做相同处理。
  该结果参与 BuildKit 缓存，导出时关闭整层时间戳重写。保留文件内容、权限、owner、链接和旧 mtime。
  不操作用户 HOME。实际固定 Dockerfile frontend 下的对照 fixture 与旧 exporter 得到相同 config ID 和 layer digest。
- 当前私有缓存为 `v2-base / mode=max` 与 `v4-prepared / mode=min`，各只有一个写入者。
  首次填充与缓存命中交付分开记录；没有使用历史 Cindy 成品镜像代替完整 Dockerfile。
- `cloud.11` 的独立准备步骤曾显示 `CACHED`，但后续并行导出又执行安装命令。该轮被取消，
  **不是成功热测，也没有发布运行时**。因此增加不导出缓存的断网读取目标：先恢复准备层并实际
  读取 Electron/Agent 二进制，再并行导出。不能只凭一个 `CACHED` 行判定准备阶段已复用。
- `cloud.13` 准备阶段仍同时导入 base max 与 prepared min 两套重叠历史，重新执行了安装。
  已取消该轮，未发布运行时。当前准备阶段只导入 prepared、基座导出只导入 base，
  runtime/records 使用已实际恢复的本地快照。`cloud.14` 与 `cloud.15` 连续验证该导入范围。
- `cloud.14` 三份日志共同证明该轮命中：`prepare-build.log` 为 `CACHED`，
  `materialize-build.log` 下载/解压 147.8 秒、实际读取检查 11.6 秒，
  `full-build.log` 准备 RUN 仍为 `CACHED`；均无安装命令输出。
  应用依然为新版本重新编译，耗时 163.8 秒。
- `cloud.15` 三份日志同样无安装输出：准备元数据 `CACHED`，恢复 333.5 秒、断网读取检查
  8.6 秒，完整构建的准备层仍为 `CACHED`。应用编译 299.1 秒，其中原生模块重编约 92 秒。
  本轮基座导出 83.0 秒、运行时导出 96.1 秒、发布 148 秒，均保留在总计时中。
- 基座导出由 `cloud.9` 的 233.6 秒降至 31.1 秒，运行时导出由 145.3 秒降至 60.2 秒。
  两者与其它构建子步骤有重叠，不能把差值相加作为总节省时间。
- ACS job 只 checkout 交付工具，实际 checkout 由 43 秒降到 4 秒；它仍是独立 Environment 和一次性 runner。
  当前复用 digest-pinned runner 自带 Node 24/npm，检查与 ACS job 的该步骤分别为 0 秒、1 秒，省去重复下载。
  云运行时的 Node 与依赖仍由原 Dockerfile/锁文件决定。

已观察到 GitHub 读取结果把执行中的或已结束的 job 回退为 queued。控制器现保留已观察到的执行状态，
等终态后清理，不再为同一 job ID 重建 runner；新 rerun 的新 job ID 仍正常供给。
`cloud.14` 三个 runner 均只创建一次，最终自动回收。

## cloud.9–15 历史计时

| 阶段 | 优化前 cloud.9 | 新缓存首次填充 cloud.10 | 挂载恢复 cloud.12 | 导入隔离 cloud.14 | 连续复测 cloud.15 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 检查 job | 1 分 30 秒 | 1 分 32 秒 | 1 分 30 秒 | 1 分 09 秒 | 1 分 06 秒 |
| 构建、启动检查与发布 job | 11 分 37 秒 | 34 分 | 10 分 06 秒 | 10 分 36 秒 | 17 分 21 秒 |
| ACS 缓存 job | 5 分 35 秒 | 5 分 53 秒 | 5 分 | 4 分 32 秒 | 4 分 32 秒 |
| 队列、供给及阶段衔接 | 6 分 26 秒 | 2 分 37 秒 | 4 分 39 秒 | 11 分 19 秒 | 100 分 23 秒 |
| Actions 创建至全部 job 收尾 | 25 分 08 秒 | 44 分 02 秒 | 21 分 15 秒 | 27 分 36 秒 | 2 小时 3 分 22 秒 |
| 其中：完整 Dockerfile 构建步骤 | 8 分 43 秒 | 30 分 32 秒 | 7 分 12 秒 | 7 分 44 秒 | 13 分 15 秒 |

[cloud.9](https://github.com/zhuoshaojian/cindy/actions/runs/39764302125)、
[cloud.10](https://github.com/zhuoshaojian/cindy/actions/runs/39779893934)、
[cloud.12](https://github.com/zhuoshaojian/cindy/actions/runs/39788846736)、
[cloud.14](https://github.com/zhuoshaojian/cindy/actions/runs/39795427148) 均由版本提交 push 自动触发。
`cloud.10` 是新缓存代次填充，不是禁用全部缓存的严格冷构建；其准备 RUN 909.9 秒，准备缓存写回 280.4 秒。
`cloud.11` 的取消记录见 [39786353609](https://github.com/zhuoshaojian/cindy/actions/runs/39786353609)。

计时包含供给、checkout、全部 Bake 调用、启动检查、发布、ACS Ready 和回执上传。
`cloud.15` push 起点 15:00:59.452688 UTC，ACS 步骤完成 17:04:17，最后 job 完成 17:04:28。
`cloud.14` push 起点为 14:24:35.654364 UTC，ACS 步骤完成于 14:52:06，最后 job 完成于 14:52:16。
`cloud.12` 本机 push 开始于 13:39:54.057 UTC，ACS 步骤完成于 14:01:00，最后 job 完成于 14:01:13。
GitHub run `updated_at` 为 14:03:08，晚于实际 job 完成；这是状态刷新时间，不用它代替完成时间。
表中使用 `created_at → 最后 job completed_at` 便于与旧数据同口径对比；新轮同时保留 push 起点。
BuildKit 日志中的 download/extract 是缓存恢复成本，不能当作重新执行依赖安装。

## cloud.15 产物与验收边界

`cloud.10`、`cloud.12`、`cloud.14` 与 `cloud.15` 的冻结源码、锁文件、基座输入和准备脚本相同；每轮使用独立原生 amd64
ECI Pod、DinD daemon、BuildKit builder 和 emptyDir，跨 runner 复用来自 Registry。
资源保持 8 vCPU / 32 GiB，DinD 为 6 vCPU / 28 GiB，实际 Docker 空间约 180 GiB。
冻结源码为 `4eb73c7f68387b79ed91f788392f47709bd45baa`（上游 `v0.1.113`）。
四轮基座 image ID 同为 `sha256:b2367496f326401cc9d52cc4c2f2f023d8154273bede8d90165e5742035f7f1f`。

`cloud.15` 配方 `bef2fc442a7866ace149df25037c8e88bd7857c9`，统一仓库 `cloud-runtime-cn`：

- `0.1.113-cloud.15-cn-amd64`
- `sha-bef2fc442a7866ace149df25037c8e88bd7857c9-cn-amd64`

两标签匿名读回同一 manifest/config，发布 image ID 与原生 smoke 完全一致，四份记录 SHA-256 全部校验。
manifest：`sha256:b85b36920a40f5e00aa5ec399d348c059ca1d5ebd18f7c83ad368924cb36f25c`。
镜像保持两层，未压缩 3,549,233,964 bytes，压缩 layers 合计 1,423,693,520 bytes。

- 原生隔离 smoke：Xfce/Plank、Cindy 可见窗口、root-owned 老 HOME、UID 10001 renderer
  沙箱、无网络、只读根和正常停机通过；ASAR 版本为 `0.1.113-cloud.15`。
- ACS 2/2 Ready，覆盖目标主镜像与清单中的实际 init。缓存存在不等于业务 Pod 已命中。
- 三个 job 的 fork 专属 runner、ECI Job/Pod、JIT 自动回收；没有触碰业务 PVC、实例或新领取策略。
- 本轮 Python 专项 30 + 18 + 50 + 4 项通过；Node 专项 128 项中 127 通过、1 项因本机 Bash 版本跳过，
  CI 在 Linux 运行相同门禁；文档检查 10 项通过。固定 exporter 对照 fixture 通过。
- 额外运行根级 runner 测试：588 项中 579 通过、7 失败、2 跳过。6 项为既有云设置路由未登记
  design inventory，另 1 项为 test-hygiene 的 Git fixture 无变化提交失败。相关脚本及路由文件与
  本轮开始时一致；保留失败，不宣称全仓测试通过。

证据在 `cloud-candidate-39800845076-1` 和 `cloud-cache-39800845076-1` artifacts。
`releaseApproved=false`、`podMatchVerified=false` 保持不变；CI 不修改 CIS 准入。
这不是 OAuth、DeviceLink 或业务实例升级验收。实例状态与升级记录见服务端
[更新验收](https://github.com/zhuoshaojian/cindy-server/blob/feat/cloud-settings-readonly/docs/cloud-instance/runtime-update-20261022.md)。
纯验收文档提交不改变发行版本，不触发交付。

## VPC 缓存实测：cloud.16

[cloud.16 / 39819852125](https://github.com/zhuoshaojian/cindy/actions/runs/39819852125)
已完整交付，使用同一私有仓库的 VPC 端点，运行时公开双标签保持不变。
三份日志再次确认准备层未重跑，完整构建 7 分 27 秒，原生 smoke、四份记录哈希、
双标签读回和 ACS 2/2 Ready 全部通过。基座 image ID 与 cloud.15 相同。

| 缓存恢复 | cloud.15 公网 | cloud.16 VPC |
| --- | ---: | ---: |
| 2.09 GB 层下载 | 203.7 秒 | 21.0 秒 |
| 895 MB 层下载 | 249.6 秒 | 10.4 秒 |
| 完整准备层恢复（含解压） | 333.5 秒 | 76.6 秒 |
| 断网读取检查 | 8.6 秒 | 8.5 秒 |
| 完整 Dockerfile 构建 | 13 分 15 秒 | 7 分 27 秒 |

切换前在同一 runner 对同一层做了 16 MiB 抽样：manifest、层 digest 和抽样 SHA-256
一致，VPC 下载实际转到 OSS 内网。上表为后续整层日志，不能用抽样速率代替。
应用编译为 234.2 秒，运行时导出 78.4 秒；没有缓存最终版本产物或跳过重新编译。

首个构建尝试在拉取固定 Dockerfile frontend 时遇到 `connection reset by peer`，
尚未进入准备层恢复、未发布镜像。只手工重试失败 job，已通过的 verify 复用。
原始 push 17:07:01.203075 UTC，ACS Ready 步骤完成 17:32:31，全部 job 完成 17:32:41：
**push 到 ACS Ready 25 分 30 秒，全部收尾 25 分 40 秒，仍未达到 20 分钟。**
首次失败 103 秒、成功构建/验收/发布 job 660 秒，均保留计入；重试 API 为已通过 verify
生成的继承结果使用原 runner 与原起止时间，不把它重复计为执行了一次。

证据为 `cloud-candidate-39819852125-1`（失败）、`cloud-candidate-39819852125-2` 与
`cloud-cache-39819852125-2`。四个实际 runner 均回收，没有修改云实例。

后续修正只对明确的构建输入元数据连接中断在同一 runner 内自动重试一次，保留首次日志及
attempts 记录；鉴权、校验和编译错误仍阻断。生产入口最小回归先红后绿，源码构建专项
14 项（0.265 秒）、交付专项 50 项通过。下一次新版本 push 继续核对完整无人介入时长，
不能把本轮手工重试后的执行时间替代原始计时。

## 更早的基线与失败记录

早期完整交付：cloud.2 50 分 21 秒，cloud.4 28 分 13 秒，cloud.7 27 分 05 秒；
分别见 [cloud.2](https://github.com/zhuoshaojian/cindy/actions/runs/39731560933)、
[cloud.4](https://github.com/zhuoshaojian/cindy/actions/runs/39747698558)、
[cloud.7](https://github.com/zhuoshaojian/cindy/actions/runs/39756631445)。
cloud.3 首次填充旧准备层的构建为 23 分，完整交付 42 分 52 秒。

cloud.5 因误删 Forge 所需 Electron ZIP 失败，已恢复；cloud.6 在构建前取消。
cloud.8 曾在元数据命中后重跑准备，并因 Docker emptyDir 只有约 30 GiB 失败，未发布运行时。
改用工具镜像自动缓存、检查 Docker 实际空闲空间后，后续 runner 的文件系统约 180 GiB。
工具镜像缓存不含 JIT、凭据、作业目录或构建数据。失败与取消不计入成功热测。

2026-10-21 旧图的受控冷/热测量使用相同输入、全新 runner：禁用缓存冷测 23 分 47 秒，
成功导入后的热测 18 分 40 秒，仅基座命中。该 Bake-only 口径不含 runner、发布和 ACS，
不能与上表直接比较；记录见 [历史测量](build-cache-benchmark-20261021.json)。
