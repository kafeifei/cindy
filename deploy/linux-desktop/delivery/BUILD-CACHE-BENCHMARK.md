# 完整镜像冷/热构建实测

2026-10-21，在 fork 专用 ACK + ECI 环境完成一组相同输入的完整镜像对比。
**耗时降低 21.52%，但只有基座复用成功；应用跨 runner 缓存复用尚未通过。**
这是直接执行交付 Bake 图的测量，不是新的 GitHub Actions 发布运行。
机器记录：[build-cache-benchmark-20261021.json](build-cache-benchmark-20261021.json)。

## 总耗时与计时口径

| 项目 | 冷构建 | 热构建（限流后重试） |
| --- | ---: | ---: |
| 完整 Bake 墙钟时间 | 1,427.142 秒（23 分 47 秒） | 1,120.004 秒（18 分 40 秒） |
| 独立原生启动/停机 smoke（另计） | 5.025 秒 | 4.938 秒 |
| 未压缩镜像大小 | 3,704,833,227 bytes | 3,704,833,227 bytes |
| 镜像层数 | 2 | 2 |

成功热轮少用 **307.138 秒（5 分 7 秒）**，耗时降低 **21.52%**，冷/热比 **1.274 倍**。
这里只测了一组未变更输入；不是多轮均值，也不代表改源码、改依赖后的增量构建速度。

计时从 `docker buildx bake` 启动至成功退出，包含依赖下载、安装、编译、打包、
Dockerfile 内审计、镜像导出并导入 DinD、构建记录导出及 `mode=max` Registry 缓存写回。
不含 ECI 创建、源码准备/传输、builder 启动、独立 smoke、GitHub 排队/checkout、
运行时镜像发布或 ACS 镜像缓存创建。源包解压分别为 1.618/1.615 秒，builder 启动为
3.387/3.332 秒，均另行记录。

## 对照条件

- 两个全新 Pod、两个全新 Docker daemon 和 BuildKit builder；开始前镜像列表为空、
  BuildKit 使用量为 0B。热轮依靠 Registry 缓存，不依靠上一台机器的本地缓存。
- 均为原生 `linux/amd64`，同型号 Xeon Platinum 8575C，Pod 总配额 8 vCPU / 32 GiB；
  DinD 6 vCPU / 28 GiB，其余资源用于 runner 与作业内 DNS。
- 相同 runner/DinD/BuildKit 固定镜像与网络配置；没有共享企业 runner、宿主目录或业务 PVC。
- 配方提交：[`61e4395a910683627b0f5a8f97d01e6a7cf5b041`](https://github.com/zhuoshaojian/cindy/commit/61e4395a910683627b0f5a8f97d01e6a7cf5b041)。
  冻结应用源码：`d4b39020bf083d79b352fcb56ea5a4941432fb39`；
  基座输入提交：`89f44a023891a295d6404611a46a5148daf55b20`。
- 两轮使用同一份源码归档，SHA-256：
  `0b6986f1b142b6d5621176eceea42aeda3442eab9660ae4abd207dfbdd0006e3`。
  相同构建参数、本地镜像名和记录输出位置；仅冷/热缓存选项不同。
- 冷轮禁用导入并设 `no-cache=true`，仍导出完整缓存；热轮导入冷轮写出的 base/runtime
  两份缓存。预检已核对缓存 manifest 一致，成功热轮的两次导入没有限流错误。

## 实际命中与瓶颈

| BuildKit 步骤 | 冷构建（秒） | 热构建（秒） | 热轮结果 |
| --- | ---: | ---: | --- |
| 基座 assembled 安装步骤 | 128.9 | CACHED | 复用；相关下载、字体安装和瘦身步骤也命中 |
| 应用构建资源下载 | 96.2 | 89.9 | 重跑 |
| pnpm 锁定依赖安装 | 189.5 | 202.6 | 重跑 |
| Linux 打包准备 | 44.7 | 63.7 | 重跑 |
| 应用编译/打包 | 164.4 | 164.6 | 重跑 |
| runtime 导出到 Docker | 218.9 | 157.3 | 两轮均导出 |
| 基座 Registry 缓存写回 | 178.1 | 1.2 | 大部分数据已存在 |
| 应用 Registry 缓存写回 | 431.6 | 351.1 | 仍上传新应用层 |

各步骤存在并行，**不能相加作为总耗时**。`CACHED` 表示复用指令结果，不表示层下载零耗时。
同一 Bake 图的 `runtime` / `records` 会共享结果，冷轮也出现图内 `CACHED`；不能用日志中
`CACHED` 的数量充当跨机器缓存命中率。

已确认热轮两份缓存导入成功，基座命中，但应用从 `WORKDIR /workspace/source` 开始失效，
后续依赖安装和编译均重跑。失效边界在 `contexts: {cindy-source-base: target:base}`
连接之后、应用源码 COPY 之前。Buildx 已有[类似问题记录](https://github.com/docker/buildx/issues/1244)，
但目前只有现象相似，**根因尚未通过最小复现确认**。完整应用缓存复用不能标为已验收。
后续应先隔离验证该跨目标边界，再决定如何修复；修复后仍需同样的全新 runner 对照测量。

## 产物与功能检查

两轮基座 image ID 和基座层相同；运行时 image ID 和应用层不同，不宣称逐字节可复现。
四份构建记录中的源码输入、覆盖层及 Agent 来源证明相同，`runtime-layer-audit.json` 不同。
该审计共比较 941 个条目，无新增/删除、权限一致，三处内容哈希不同：

- `opt/cindy/resources/app.asar`
- `opt/cindy/resources/app.asar.unpacked/node_modules/node-pty/build/Makefile`
- `opt/cindy/resources/cindy-source.json`

两份产物各自通过发布结构审计及原生隔离 smoke：Xfce/Plank 与 Cindy 可见窗口、
老 HOME 的 root-owned 目录条件、UID 10001 renderer 沙箱、无网络、只读根文件系统、正常停机。
这不代表本轮完成 OAuth、DeviceLink 或生产业务身份验收。
镜像 config/layer 摘要、四份记录哈希、日志 SHA-256 和 smoke 结果均保存在机器记录中。

## 失败与重试，不计入成功轮对比

1. 初次在 `989a2a2e66` 冷测时发现 `Dockerfile.dockerignore` 漏放行 `build-recipe/`，
   构建失败。已在被测提交 `61e4395a91` 修复，并新增 COPY 输入与 ignore 规则回归测试。
   上面的冷/热结果均来自修复后的同一提交。
2. 首次热测读取基座缓存 manifest 时收到 ACR `429 Too Many Requests`；BuildKit 记录
   importer 错误后自动回退重建。该轮已停止并保留证据，未冒充缓存命中计入加速比。
   确认两份缓存仍可读取且摘要未变后，在新的空白 Pod 重试，得到上面的热轮结果。
   因此 21.52% 是成功导入后的单次测量，不包含限流导致的等待和重试成本。

## 复测方式与变更范围

使用同一提交的 [`build-image.py`](../build-image.py) 生成上下文及 `bake_plan`，
冷轮对应 `--no-cache --cache-repository <private-cache-repository>`，热轮去掉 `--no-cache`。
分别在全新 native-amd64 daemon/builder 上准备相同源码归档、固定输入与构建工具；
检查初始状态，再对以下命令单独计时（路径按各自环境替换）：

```sh
docker buildx bake --builder cache-benchmark \
  --allow=fs.write=/ci/results --progress=plain \
  -f /ci/bake.json --metadata-file /ci/results/build-metadata.json \
  base runtime records
```

测量所用 `bake-cold.json` / `bake-warm.json` 分别是该命令的 `-f` 输入；两者均来自
现有交付代码，不另写简化 Dockerfile。结束后分别执行 `release_guard.audit_image` 和
[`delivery/smoke.py`](smoke.py)，记录各自结果。Registry 凭据只通过临时 Docker 配置注入。

本轮仅更新私有 BuildKit 缓存。未发布或覆盖 `cloud.1`，未改 CIS、云实例、新认领默认或
上游/企业 runner。测试 Job、Pod、临时 Secret 和 ConfigMap 已清理；真实构建缓存保留供后续使用。
