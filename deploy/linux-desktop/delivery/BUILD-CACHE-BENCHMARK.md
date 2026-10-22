# 完整镜像构建缓存与交付实测

2026-10-22，`0.1.113-cloud.14` 与 `cloud.15` 在两台全新 runner 上连续复用准备缓存。
两轮三份日志均证明恢复了真实文件系统，完整构建没有重跑依赖下载/安装，且都通过原生
隔离启动、双标签发布和 ACS 2/2 Ready。**缓存连续命中已验证，20 分钟完整交付目标仍未达成。**

最新 [cloud.15 / 39800845076](https://github.com/zhuoshaojian/cindy/actions/runs/39800845076)：
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

## 本轮完整计时

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

## 产物与验收边界

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

## 下一轮：缓存通过 VPC 读取

在 cloud.15 runner 内对同一缓存层抽取 16 MiB，公网与 VPC 的 manifest、层 digest 和
抽样 SHA-256 完全一致。公网 0.392 秒（40.77 MiB/s），VPC 0.252 秒（63.44 MiB/s）；
VPC 路径实际重定向至 OSS 内网。**这是单次小样本连通性检查，不能代替整层恢复或完整交付。**

后续通过已有 `CLOUD_IMAGE_BUILD_CACHE_REPOSITORY` 选择同一仓库的 VPC 端点；运行时发布
仓库、双标签和缓存内容不变。下一轮仍从 push 计时，包含原生 smoke、发布和 ACS Ready。
原生模块重编与编译本身也有波动，本次保留原验收和构建规则，不以跳过检查换取数字。

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
