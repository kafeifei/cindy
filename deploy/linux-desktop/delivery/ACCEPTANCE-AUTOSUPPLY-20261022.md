# fork runner 自动供给与 push 交付验收

日期：2026-10-22。范围仅为客户端 fork 的候选镜像交付，不修改 CIS 准入、
存量实例、新认领默认或稳定通道。不能将镜像交付成功等同于 OAuth / DeviceLink 产品验收。

## 提交与触发

- 控制器提交：`be1c64a77f1c37ffb61c061bb3c023c37f5d767c`。
- 发行提交：`c9c0aa727dc278db4401dce2d1b4a8a73ff90c9d`。
- 冻结应用源码：`4eb73c7f68387b79ed91f788392f47709bd45baa`；上游 `v0.1.113`。
- 新发行版本：`0.1.113-cloud.2`；正式客户端源码版本不改。
- [控制器提交检查](https://github.com/zhuoshaojian/cindy/actions/runs/39730337869)：push 触发、verify 成功，版本未变因此 candidate/cache 跳过。
- [新版本完整交付](https://github.com/zhuoshaojian/cindy/actions/runs/39731560933)：push 触发，第 1 次尝试，verify/candidate/cache 全部成功。

完整交付期间只读取状态与产物，没有 workflow_dispatch、手工注册 runner、手工推镜像或补建缓存。
控制器持续运行于 ACK；每个 GitHub job 使用一次性 ECI，结束后自动注销和回收。
没有使用主仓、企业或已有 GitLab runner。

## 自动供给与恢复

普通提交检查期间，主动删除控制器 Pod 做恢复验收：新 Pod 自动取得 Lease；执行中的
runner ID、ECI Pod UID、Job UID 不变，容器 restartCount 均为 0。GitHub 检查继续成功。
短期 JIT Secret 自动删除；检查完成后 runner 注册、ECI Job/Pod 都已回收。

权限实测：可以在专属 namespace 创建 Job；不能修改业务 namespace 的 Deployment，
不能读取云实例 PVC，也没有列举 Secret 的权限。控制器使用 operator 选定的既有 GitHub
管理凭据，单独保存在 Kubernetes Secret，不将其宣称为新建的最小权限 PAT；runner 不挂载它。
ACR 与 ACS 继续使用各自 GitHub Environment 的独立 AK。

本地控制器/交付回归 42 项、Node 交付回归 13 项、文档检查 10 项通过。
新控制器用例覆盖重复轮询、重启续接、丢失 JIT、取消清理、有限重试和 Lease 排他。
取消/注册响应丢失的覆盖为内存故障模拟；真实故障演练只执行了控制器 Pod 重建。

## 新镜像与结果

| 项目 | 实际结果 |
| --- | --- |
| 运行 | `39731560933`，event=`push`，run_attempt=`1` |
| 标签 | `0.1.113-cloud.2-cn-amd64` |
| Registry manifest | `sha256:a0e03c1090b3e1eb9dafa3513696fc8830cddd4ad752bd2df9946ae2fb75f404` |
| Image config | `sha256:2f8c5998a16f7290dc04b1e60fd11f8b86cdaf324b143785082ec1272fe344e4` |
| 层数 / 大小 | 2 层；未压缩 3,549,233,878 bytes，Registry layers 合计 1,423,693,422 bytes |
| 包内版本 | `0.1.113-cloud.2` |
| 原生隔离验收 | Xfce/Plank、可见主窗口、老 HOME 权限、非 root renderer 沙箱、只读根、断网及正常停机通过 |
| 发布与记录 | 匿名读取 Registry tag/digest/config 一致；构建、smoke、发布 image ID 一致；四份构建记录 SHA-256 一致 |
| ACS | 2/2 Ready；新镜像缓存 `imc-uf6c2ys46pzszrugflum`，另一个为清单中已有模板镜像的缓存复用 |
| 自动供给 | check/build/cache 分别为 runner 41/42/43，每个仅创建 1 次，无手工注册或接管 |
| 自动回收 | 三个注册均消失；管理标签下 Job、Pod、JIT Secret 均为 0；控制器保留且 Ready |

这是**一份新云镜像**。缓存计划中，新领取/同步升级的目标 main 与 init 使用同一新镜像精确引用；缓存清单还覆盖
已有模板引用，2 个缓存不代表发布 2 份新运行时。本轮没有应用这些模板或修改任何云实例。
候选记录 artifact `12407516133`，最终 ACS 回执 artifact `12407726263`。
`candidate.json` 在发布阶段冻结，最终缓存状态来自单独的 `cache-status.json`；两者已按镜像
精确引用核对。ACS Ready 不等于实际 Pod 缓存命中，本轮 `podMatchVerified=false`；
新的 OAuth、DeviceLink 与实例灰度不在本次 CI 交付范围，未将其标记为通过。

## 耗时与缓存边界

从 GitHub 收到 push 到 workflow 成功为 **50 分 21 秒**（06:03:08–06:53:29 UTC）。
verify 执行 8 分 23 秒、candidate 执行 30 分 50 秒、cache 执行 5 分 40 秒；
其余为队列与临时 ECI 启动。最后一个 runner 在 06:54:51 UTC 的轮询中确认已回收。

完整 Dockerfile 构建步骤耗时 **25 分 46 秒**，其中应用包编译约 **227.5 秒**，
构建缓存导出 **602.2 秒**。系统包安装/基座裁剪命中 Registry 缓存；应用资产下载
（87.9 秒）、依赖安装（196.2 秒）和 Linux 准备（80.1 秒）仍重新执行。
同一次 bake 中 records 复用 runtime 已完成的步骤不计为跨 runner 热缓存命中。
因此本轮证明了基座缓存复用，**未证明完整应用热构建加速**；既有限制见
[冷/热构建验收](BUILD-CACHE-BENCHMARK.md)。

源码、部署方式、故障处理与权限边界见 [runner 说明](runner/README.md)。
