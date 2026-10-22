# 完整镜像构建缓存与交付实测

2026-10-22，最新 `0.1.113-cloud.9` 已在全新 fork 专属 ECI runner 完成交付。
完整 Dockerfile 构建为 **8 分 43 秒**，从 push 到 ACS Ready 为 **25 分 08 秒**。
与最初 `cloud.2` 相比，分别减少 **66.2%**、
**50.1%**；相较前一轮已命中缓存的 `cloud.4`，
构建只再缩短 26 秒。以下是单次实测，包含网络和供给波动，不是性能均值。

## 完整交付计时

| 阶段 | 原始 cloud.2 | 旧准备层热交付 cloud.4 | 精简层首次填充 cloud.7 | 精简层热交付 cloud.9 |
| --- | ---: | ---: | ---: | ---: |
| 检查 job | 8 分 23 秒 | 1 分 33 秒 | 1 分 31 秒 | 1 分 30 秒 |
| 构建、启动检查与发布 job | 30 分 50 秒 | 12 分 10 秒 | 15 分 06 秒 | 11 分 37 秒 |
| ACS 缓存 job | 5 分 40 秒 | 5 分 37 秒 | 6 分 11 秒 | 5 分 35 秒 |
| 队列、供给及阶段衔接 | 5 分 28 秒 | 8 分 53 秒 | 4 分 17 秒 | 6 分 26 秒 |
| 完整交付 | 50 分 21 秒 | 28 分 13 秒 | 27 分 05 秒 | 25 分 08 秒 |
| 其中：完整 Dockerfile 构建步骤 | 25 分 46 秒 | 9 分 09 秒 | 12 分 12 秒 | 8 分 43 秒 |

对应 Actions：[cloud.2](https://github.com/zhuoshaojian/cindy/actions/runs/39731560933)、
[cloud.4](https://github.com/zhuoshaojian/cindy/actions/runs/39747698558)、
[cloud.7](https://github.com/zhuoshaojian/cindy/actions/runs/39756631445)、
[cloud.9](https://github.com/zhuoshaojian/cindy/actions/runs/39764302125)。
均由版本提交的 push 自动触发；成功运行没有手工 dispatch、注册作业 runner、推送镜像或补建 ACS 缓存。

完整交付按 GitHub `created_at` 至最后完成计时，包含队列、ECI 启动、checkout、检查、构建、
smoke、发布和 ACS Ready。构建步骤包括独立的 `prepare-build` 和后续 `full-build`，没有漏掉
前一个 solve。BuildKit 子步骤会重叠，不能相加当墙钟时间。`cloud.9` 开始前更新了 runner
控制器，首段队列含旧 Lease 接管等待，仍计入总耗时。

## 准备层的实际命中

`cloud.7` 与 `cloud.9` 的冻结源码、pnpm 锁、准备脚本、Dockerfile 和基座输入逐项相同。
冻结源码为 `4eb73c7f68387b79ed91f788392f47709bd45baa`，上游 `v0.1.113`，
两者导出的基座 image ID 同为 `sha256:69cce7a9697eba1f4e0c70309e827db962a774979f2b81c53143c51ead046f55`。
云修订在准备阶段之后注入，`cloud.9` 实际重新编译，包内版本不是旧版本。

- 去掉已消费的 Agent 压缩包、apt 索引和 npm 下载缓存，pnpm 下载 store 留在 cache mount；
  保留 Forge 打包仍需读取的 Electron ZIP。准备 RUN 的压缩层从 3,049,453,735 bytes 降到
  2,091,885,804 bytes，减少 31.4%。最终运行时仍约 1.42 GB 压缩体积，这两者不是同一个数字。
- `cloud.7` 首次填充执行准备 324.1 秒、缓存写回 252.9 秒；这不是禁用所有缓存的严格冷构建。
- `cloud.9` 先独立解析并导出准备缓存，再并行导出 base/runtime/records。
  `prepare-build.log` 的准备 RUN 为 `CACHED`，缓存写回 1.0 秒；`full-build.log` 恢复文件层
  151.9 秒，编译 168.7 秒，运行时导出 145.3 秒。准备 RUN 没有下载/安装命令输出。
  `CACHED` 仍需下载解压，不代表零耗时。
- 两轮各用独立 8 vCPU / 32 GiB 原生 amd64 ECI，DinD 为 6 vCPU / 28 GiB；
  Pod、daemon、BuildKit builder 均不同，Docker 数据是各自 emptyDir，无共享业务 PVC。
  BuildKit 固定 digest 一致。跨 runner 复用来自 Registry。
- 检查 job 只安装锁定的六项检查依赖，完整应用依赖由 Docker 构建负责；本轮检查依赖安装 3 秒。
  checkout 使用 `blob:none` 保留完整历史，源码归档哈希与完整 clone 一致。

## 下一步优化依据

本轮已消除重复依赖准备。剩余主要时间来自缓存搬运、应用编译、镜像导出和阶段供给：

| 剩余环节 | cloud.9 实测 | 下一步验证方向 |
| --- | ---: | --- |
| 准备层恢复 | 151.9 秒 | 继续减少准备层中无用文件，不能删掉 Forge 后续会读取的 Electron ZIP |
| 应用编译 | 168.7 秒 | 区分与云修订无关的产物，先证明版本注入及内容一致，再考虑更细粒度缓存 |
| 基座导出 | 233.6 秒，与其它 solve 重叠 | 评估用构建元数据和实际运行时首层证明替代单独加载基座；现有审计仍依赖该基座，不能直接删步骤 |
| 运行时导出 | 145.3 秒 | 比较压缩/导出路径；仍须 smoke 与实际发布为同一 image config 和 digest |
| 镜像发布 / ACS 创建 | 87 / 236 秒 | 属于交付耗时，不能从构建提速数字里隐藏 |
| 队列与阶段衔接 | 6 分 26 秒 | 先分离正常供给与控制器换代等待，再测 runner 阶段合并的收益及凭据隔离 |

这些是下一轮实验方向，尚未宣称取得额外加速。子步骤有重叠，不能相加或直接当作可节省时间。
当前保留独立 job 的凭据边界和完整审计；不复用含发布凭据的作业目录，不引入业务 PVC。

## runner 缓存与磁盘修复

工具镜像启用 ECI 自动 ImageCache。实际构建 Pod 命中工具缓存，从创建到三个容器启动约 31 秒。
这只缓存固定的 runner/DinD 镜像，不包含 JIT、发布凭据、作业目录或构建数据。

中间的 [cloud.8](https://github.com/zhuoshaojian/cindy/actions/runs/39760188928) **失败，不计作成功热测**：
并行 solve 导入 Registry 缓存后仍重跑准备；随后组装报 `ENOSPC`，未发布运行时，也未进入 ACS job。
实测手工 ECI ImageCache 虽扩展了根盘，emptyDir 所在系统盘仍约 30 GiB。
已仅删除本次创建的手工工具缓存，改用自动缓存；实际 root/emptyDir 均约 180 GiB。
DinD 领取 job 前检查 `/var/lib/docker` 至少有 80 GiB 空闲空间；本轮检查通过。
不能仅看扩容注解就认定 Docker 已获得空间。差异见
[阿里云临时存储说明](https://help.aliyun.com/zh/ack/increase-the-capacity-of-the-temporary-storage-space)。

此前 `cloud.5` 因误删 Forge 所需 Electron ZIP 失败；已恢复该 ZIP。`cloud.6` 在构建前取消。
失败/取消的专属 runner 已回收，未用跳过启动检查或放宽审计来制造成功。

## 产物与验收边界

本轮配方 `5ff5d781fddeb3ecfef7db270ae303e25e7b656e`，统一仓库 `cloud-runtime-cn`，两个不可变标签：

- `0.1.113-cloud.9-cn-amd64`
- `sha-5ff5d781fddeb3ecfef7db270ae303e25e7b656e-cn-amd64`

匿名读回同一 manifest `sha256:8d649dba5d0f60826eb79d3b0fc8a62ee11e489607075818c297b271bb8d1bd8`，
config `sha256:aae2f7822635f5c8002df6d76a4b439ae6f077ee9791238f15c82ff6977f33c1`。
镜像仍为两层，未压缩 3,549,233,962 bytes，Registry layers 合计 1,423,693,455 bytes。
原生 smoke、发布产物及四份构建记录的 SHA-256 逐项一致。

- 原生隔离 smoke 通过：Xfce/Plank、Cindy 可见窗口、root-owned 老 HOME、UID 10001 renderer
  沙箱、无网络、只读根、正常停机；实际 ASAR 版本为 `0.1.113-cloud.9`。
- ACS 2/2 Ready，覆盖目标主镜像和实际 init 引用；已有模板缓存复用不等于发布两份新运行时。
- 三个 job 均只申请一次 fork 专属 runner；GitHub 注册、ECI Job/Pod 和 JIT 自动回收，控制器 Ready。
- 另跑原生客户端双版本投影、实例控制和设置按钮回归：78 项通过。这是自动化回归，不是界面 E2E。

证据在运行的 `cloud-candidate-39764302125-1` 与 `cloud-cache-39764302125-1` artifacts。
CI 回执仍为 `releaseApproved=false`、`podMatchVerified=false`，CI 不访问业务 PVC 或更新 CIS 准入。
本人准入、业务 Pod 缓存命中与升级状态见服务端
[双版本更新验收](https://github.com/zhuoshaojian/cindy-server/blob/feat/cloud-settings-readonly/docs/cloud-instance/runtime-update-20261022.md)。
本节只记录 CI 交付证据，不将其冒充 OAuth、DeviceLink 或业务实例升级验收。
后续存量推广、新领取选版与客户端安装包见服务端更新验收记录。
纯验收文档提交不改变发行版本，不触发交付。

## 更早的测量口径

`cloud.3` 首次填充旧准备层：构建 23 分，完整交付 42 分 52 秒，见
[运行 39742409932](https://github.com/zhuoshaojian/cindy/actions/runs/39742409932)。
2026-10-21 旧图的受控冷/热测量使用相同输入、全新 runner：禁用缓存冷测 23 分 47 秒，
成功导入后的热测 18 分 40 秒，仅基座命中。该 Bake-only 口径不含 runner、发布和 ACS，
不能与上表直接比较；记录见 [历史测量](build-cache-benchmark-20261021.json)。
