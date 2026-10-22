# 完整镜像构建缓存与交付实测

2026-10-22，拆分缓存导入范围后的 `0.1.113-cloud.14` 完成真实交付：
**完整构建 7 分 44 秒，push 到 ACS Ready 27 分 30 秒，全部 job 收尾 27 分 40 秒**。
三份日志确认准备层实际恢复、后续没有重跑下载或安装；同轮新版本仍重新编译、启动验收并发布。
构建 runner 已监听后等待分配 8 分 49 秒，完整交付仍未达到 20 分钟。
以下均为全新 fork 专属 ECI runner 的单次实测，包含网络与供给波动，不代表性能保证。

连续复测 `cloud.15` 已由 [39800845076](https://github.com/zhuoshaojian/cindy/actions/runs/39800845076)
自动排队，当前尚未执行，不能宣称连续命中或 20 分钟达标。GitHub 在 2026-10-22 14:18 UTC
公告 Actions Results 故障，14:35 UTC 仍在处理 workflow 与步骤结果延迟，见
[官方故障记录](https://www.githubstatus.com/incidents/q29p76qtnkyk)。该时间段与本轮状态滞后重叠；
实测总耗时保留，不能扣掉等待后当作完整交付结果。`cloud.15` 待验收的内容是同输入在另一台
全新 runner 上三份日志均不重跑准备、完整 smoke/双标签/ACS Ready，以及 push 起点的总计时。

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
  runtime/records 使用已实际恢复的本地快照。`cloud.14` 已验证该导入范围。
- `cloud.14` 三份日志共同证明该轮命中：`prepare-build.log` 为 `CACHED`，
  `materialize-build.log` 下载/解压 147.8 秒、实际读取检查 11.6 秒，
  `full-build.log` 准备 RUN 仍为 `CACHED`；均无安装命令输出。
  应用依然为新版本重新编译，耗时 163.8 秒。
- 基座导出由 `cloud.9` 的 233.6 秒降至 31.1 秒，运行时导出由 145.3 秒降至 60.2 秒。
  两者与其它构建子步骤有重叠，不能把差值相加作为总节省时间。
- ACS job 只 checkout 交付工具，实际 checkout 由 43 秒降到 4 秒；它仍是独立 Environment 和一次性 runner。
  当前复用 digest-pinned runner 自带 Node 24/npm，检查与 ACS job 的该步骤分别为 0 秒、1 秒，省去重复下载。
  云运行时的 Node 与依赖仍由原 Dockerfile/锁文件决定。

已观察到 GitHub 读取结果把执行中的或已结束的 job 回退为 queued。控制器现保留已观察到的执行状态，
等终态后清理，不再为同一 job ID 重建 runner；新 rerun 的新 job ID 仍正常供给。
`cloud.14` 三个 runner 均只创建一次，最终自动回收。

## 本轮完整计时

| 阶段 | 优化前 cloud.9 | 新缓存首次填充 cloud.10 | 挂载恢复 cloud.12 | 导入隔离 cloud.14 |
| --- | ---: | ---: | ---: | ---: |
| 检查 job | 1 分 30 秒 | 1 分 32 秒 | 1 分 30 秒 | 1 分 09 秒 |
| 构建、启动检查与发布 job | 11 分 37 秒 | 34 分 | 10 分 06 秒 | 10 分 36 秒 |
| ACS 缓存 job | 5 分 35 秒 | 5 分 53 秒 | 5 分 | 4 分 32 秒 |
| 队列、供给及阶段衔接 | 6 分 26 秒 | 2 分 37 秒 | 4 分 39 秒 | 11 分 19 秒 |
| Actions 创建至全部 job 收尾 | 25 分 08 秒 | 44 分 02 秒 | 21 分 15 秒 | 27 分 36 秒 |
| 其中：完整 Dockerfile 构建步骤 | 8 分 43 秒 | 30 分 32 秒 | 7 分 12 秒 | 7 分 44 秒 |

[cloud.9](https://github.com/zhuoshaojian/cindy/actions/runs/39764302125)、
[cloud.10](https://github.com/zhuoshaojian/cindy/actions/runs/39779893934)、
[cloud.12](https://github.com/zhuoshaojian/cindy/actions/runs/39788846736)、
[cloud.14](https://github.com/zhuoshaojian/cindy/actions/runs/39795427148) 均由版本提交 push 自动触发。
`cloud.10` 是新缓存代次填充，不是禁用全部缓存的严格冷构建；其准备 RUN 909.9 秒，准备缓存写回 280.4 秒。
`cloud.11` 的取消记录见 [39786353609](https://github.com/zhuoshaojian/cindy/actions/runs/39786353609)。

计时包含供给、checkout、全部 Bake 调用、启动检查、发布、ACS Ready 和回执上传。
`cloud.14` push 起点为 14:24:35.654364 UTC，ACS 步骤完成于 14:52:06，最后 job 完成于 14:52:16。
`cloud.12` 本机 push 开始于 13:39:54.057 UTC，ACS 步骤完成于 14:01:00，最后 job 完成于 14:01:13。
GitHub run `updated_at` 为 14:03:08，晚于实际 job 完成；这是状态刷新时间，不用它代替完成时间。
表中使用 `created_at → 最后 job completed_at` 便于与旧数据同口径对比；新轮同时保留 push 起点。
BuildKit 日志中的 download/extract 是缓存恢复成本，不能当作重新执行依赖安装。

## 产物与验收边界

`cloud.10`、`cloud.12` 与 `cloud.14` 的冻结源码、锁文件、基座输入和准备脚本相同；每轮使用独立原生 amd64
ECI Pod、DinD daemon、BuildKit builder 和 emptyDir，跨 runner 复用来自 Registry。
资源保持 8 vCPU / 32 GiB，DinD 为 6 vCPU / 28 GiB，实际 Docker 空间约 180 GiB。
冻结源码为 `4eb73c7f68387b79ed91f788392f47709bd45baa`（上游 `v0.1.113`）。
三轮基座 image ID 同为 `sha256:b2367496f326401cc9d52cc4c2f2f023d8154273bede8d90165e5742035f7f1f`。

`cloud.14` 配方 `f42a614e27875f6aa1bcbddfb410da2fe2cea69c`，统一仓库 `cloud-runtime-cn`：

- `0.1.113-cloud.14-cn-amd64`
- `sha-f42a614e27875f6aa1bcbddfb410da2fe2cea69c-cn-amd64`

两标签匿名读回同一 manifest/config，发布 image ID 与原生 smoke 完全一致，四份记录 SHA-256 全部校验。
镜像保持两层，未压缩 3,549,233,964 bytes，压缩 layers 合计 1,423,693,603 bytes。

- 原生隔离 smoke：Xfce/Plank、Cindy 可见窗口、root-owned 老 HOME、UID 10001 renderer
  沙箱、无网络、只读根和正常停机通过；ASAR 版本为 `0.1.113-cloud.14`。
- ACS 2/2 Ready，覆盖目标主镜像与清单中的实际 init。缓存存在不等于业务 Pod 已命中。
- 三个 job 的 fork 专属 runner、ECI Job/Pod、JIT 自动回收；没有触碰业务 PVC、实例或新领取策略。
- 本轮 Python 专项 30 + 18 + 46 + 4 项通过；Node 专项 128 项中 127 通过、1 项因本机 Bash 版本跳过，
  CI 在 Linux 运行相同门禁；文档检查 10 项通过。固定 exporter 对照 fixture 通过。
- 额外运行根级 runner 测试：588 项中 579 通过、7 失败、2 跳过。6 项为既有云设置路由未登记
  design inventory，另 1 项为 test-hygiene 的 Git fixture 无变化提交失败。相关脚本及路由文件与
  本轮开始时一致；保留失败，不宣称全仓测试通过。

证据在 `cloud-candidate-39795427148-1` 和 `cloud-cache-39795427148-1` artifacts。
`releaseApproved=false`、`podMatchVerified=false` 保持不变；CI 不修改 CIS 准入。
这不是 OAuth、DeviceLink 或业务实例升级验收。实例状态与升级记录见服务端
[更新验收](https://github.com/zhuoshaojian/cindy-server/blob/feat/cloud-settings-readonly/docs/cloud-instance/runtime-update-20261022.md)。
纯验收文档提交不改变发行版本，不触发交付。

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
