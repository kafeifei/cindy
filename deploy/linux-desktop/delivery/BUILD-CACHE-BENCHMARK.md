# 完整镜像构建缓存与交付实测

2026-10-22，应用准备层已在**全新 fork self-hosted ECI runner** 上复用成功。
相较优化前同日的真实交付，完整 Dockerfile 构建步骤从 **25 分 46 秒降到 9 分 09 秒**，
减少 **64.5%**；从 push 到 ACS Ready 的完整交付从
**50 分 21 秒降到 28 分 13 秒**，减少 **44.0%**。

## 实际运行与计时口径

| 阶段 | 优化前 cloud.2 | 新缓存首次填充 cloud.3 | 新 runner 热交付 cloud.4 |
| --- | ---: | ---: | ---: |
| 检查 job | 8 分 23 秒 | 2 分 43 秒 | 1 分 33 秒 |
| 构建、启动检查与发布 job | 30 分 50 秒 | 28 分 33 秒 | 12 分 10 秒 |
| ACS 缓存 job | 5 分 40 秒 | 5 分 46 秒 | 5 分 37 秒 |
| 队列、供给及阶段衔接 | 5 分 28 秒 | 5 分 50 秒 | 8 分 53 秒 |
| 完整交付 | 50 分 21 秒 | 42 分 52 秒 | 28 分 13 秒 |
| 其中：完整 Dockerfile 构建步骤 | 25 分 46 秒 | 23 分 00 秒 | 9 分 09 秒 |

- 优化前：[运行 39731560933](https://github.com/zhuoshaojian/cindy/actions/runs/39731560933)。
- 首次填充：[运行 39742409932](https://github.com/zhuoshaojian/cindy/actions/runs/39742409932)，配方 `50a5e0cc39edc142ebfdb143d3952c5de85aa2f2`。
- 热交付：[运行 39747698558](https://github.com/zhuoshaojian/cindy/actions/runs/39747698558)，配方 `5a17e67e23281acd5388b1e2891421e0ac5ee9b3`。

三轮均由版本提交的 push 自动触发。新两轮均一次成功，没有手动 dispatch、注册 runner、
推送镜像或补建 ACS 缓存。完整交付包含队列、ECI 拉镜像/启动、checkout、检查、构建、
smoke、发布和 ACS Ready；按 GitHub created_at 至最后完成计时。构建步骤包括源码准备、
Bake、缓存传输、镜像导入及审计。BuildKit 子步骤有并行，不能相加代替墙钟时间。

这是实际发行前后对比，各轮云修订不同；`cloud.3` 是新构建图的首次缓存填充，
不是禁用全部缓存的严格冷测。每种情况各测一次，包含网络和 ECI 供给波动，不是性能均值。
旧图相同输入的严格冷/热测量保留在页末。

## 应用缓存如何证明命中

两轮使用相同的冻结应用源码 `4eb73c7f68387b79ed91f788392f47709bd45baa`、
上游 `v0.1.113`、pnpm 锁、准备脚本和基座配方；基座来源为
`89f44a023891a295d6404611a46a5148daf55b20`。
两份记录的 base image ID 相同，运行时 image ID 不同，包内版本分别为 `cloud.3`、`cloud.4`。
源码归档、固定输入和准备脚本逐项核对一致，未以旧应用替代新版本。

构建各用独立的 8 vCPU / 32 GiB 原生 amd64 ECI，DinD 为 6 vCPU / 28 GiB。
两个 Pod UID、Docker daemon/BuildKit builder 均不同；Docker 数据为各自 emptyDir，
不挂共享磁盘或业务 PVC，runner/DinD 固定镜像相同。热轮依靠 Registry 缓存。

| 步骤 | cloud.3 首次填充 | cloud.4 热交付 |
| --- | ---: | ---: |
| Agent/Electron 下载、pnpm 安装、Linux 准备 | 执行 446.7 秒 | RUN 命中；缓存恢复 199.1 秒 |
| 应用准备缓存写回 | 622.4 秒 | 1.9 秒 |
| 应用编译与打包 | 303.2 秒 | 158.7 秒，真实重编 |
| 基座缓存写回 | 178.2 秒 | 1.1 秒 |
| 最终运行时导出到 Docker | 218.8 秒 | 140.3 秒 |

热轮准备 RUN 的 `#33` 明确为 `CACHED`；`#39` 对同一结果下载、解压 Registry blobs，
没有准备脚本的命令输出，耗时 199.1 秒。**CACHED 不等于下载零耗时。**
首次填充有真实准备执行；不能把同一 Bake 图中 records/runtime 共享结果产生的 CACHED
当作跨 runner 命中。热轮仍重编并检查实际 `app.asar` 为 `0.1.113-cloud.4`。

两份完整 Dockerfile 组合为一个阶段图，应用直接继承基座阶段。
准备层保留在独立私有 Registry 缓存；云修订号只在后续编译阶段使用。
构建不再重复下载准备阶段已有的系统库，不再向 Registry 写回编译目录、打包副本和 `/layer`
重复临时层。修改冻结源码、准备脚本、依赖或基座，仍会使相关缓存失效。

检查 job 只安装锁定的六项检查依赖，原有检查集合保持不变；完整应用依赖由 Docker
构建负责。依赖安装从优化前 321 秒降到
热轮 5 秒。checkout 保留完整提交历史，使用 blob:none
按需取源码；已核对完整 clone 与 partial clone 的冻结源码归档 SHA-256 一致。

## 发布产物与验收

仓库统一为 `cloud-runtime-cn`，本轮两个不可变标签：

- `0.1.113-cloud.4-cn-amd64`
- `sha-5a17e67e23281acd5388b1e2891421e0ac5ee9b3-cn-amd64`

二者匿名读回相同 Registry manifest：`sha256:d7212d98200932f9c3c200745b014cc704505413a77cbd78f543f948ebb3bbca`。
Image config 为 `sha256:596e324babd40e9916910d5e31aa19186abba282050402645071440b53a10c95`；仍为 2 层，
未压缩 3,549,233,878 bytes，Registry layers 合计 1,423,693,506 bytes。
构建、原生 smoke、推送产物与四份构建记录的 SHA-256 已核对一致。

- 原生隔离检查通过：Xfce/Plank、Cindy 可见窗口、root-owned 老 HOME、UID 10001 renderer
  沙箱、无网络、只读根和正常停机；包内应用版本为 `0.1.113-cloud.4`。
- ACS 2/2 Ready，逐项覆盖目标主容器与实际 init 精确引用。一个是本轮新运行时，另一个是
  目标清单中已有模板镜像的缓存复用；不是发布两份新云镜像。
- 两轮共六个 job 均仅申请一次 fork 专属 runner；GitHub 注册、ECI Job/Pod、临时 JIT
  Secret 已自动回收，供给控制器继续 Ready。
- ACR 运行时仓库启用不可变标签；两个标签都先查冲突，失败重试只补缺失标签。
  构建缓存仍是独立私有、可更新仓库，不进入实例镜像清单。

候选和最终缓存回执分别在上述 Actions 的 `cloud-candidate-<run>-1` 与
`cloud-cache-<run>-1` artifact 中。发布记录保留 `releaseApproved=false`、
`podMatchVerified=false`；本轮没有操作 CIS、存量实例、新认领默认或主仓/企业 runner。
OAuth、DeviceLink 和实际业务 Pod 缓存命中不属于本次构建 smoke，未标记为通过。
验收文档提交不改发行版本，按路径规则不触发交付。

## 剩余耗时与历史基线

热构建仍需恢复约 3.05 GB 的应用准备层、编译新版本、导出/推送约 1.42 GB 的运行时层，
以及创建 ACS 缓存。缓存解决重复计算和下载，不消除全部网络传输。
这次构建 runner 的 ECI 镜像拉取约 4 分钟，已计入队列/供给和完整交付总耗时，
没有从加速统计中删掉。后续优化优先看准备层体积和 runner 工具镜像供给，
不能跳过构建审计或启动验收来缩短数字。

2026-10-21 的旧图受控测量：相同输入、全新 runner，禁用缓存冷测 23 分 47 秒，
成功导入后的热测 18 分 40 秒，仅基座命中，应用准备重跑。该 Bake-only 口径不包含
runner、发布和 ACS，不能与上面的完整交付直接比较。其机器记录保持在
[build-cache-benchmark-20261021.json](build-cache-benchmark-20261021.json)；
2026-10-22 cloud.2 自动供给与历史限制见 [原验收记录](ACCEPTANCE-AUTOSUPPLY-20261022.md)。
首次旧热测曾发生 Registry 429 后回退重建，未计入成功轮；新两轮未重试。
