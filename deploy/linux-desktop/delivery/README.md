# 云镜像自动交付（客户端 fork）

入口：[zhuoshaojian/cindy · feat/cloud-settings-native-client](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client)，
流水线：[cloud-image-delivery.yml](../../../.github/workflows/cloud-image-delivery.yml)。
这里属于 `cindy`；`cindy-server` 的 CIS 负责消费合格镜像、备份、升级和恢复。
本目录不会访问业务 PVC、修改实例或新认领默认。

每个版本交付一份云运行时镜像。主容器和本仓提供的 init 应使用这份镜像的同一精确引用；
Runner、DinD、BuildKit 是构建工具，不是云实例需要安装的额外产品。

## 已实现与尚未接通

| 阶段 | 本分支能力 | 启用/验收状态 |
| --- | --- | --- |
| runner 自动供给 | 专属 ACK 队列控制器，仓库级 JIT + 一次性 ECI，Lease/状态续接与自动回收 | push 完整交付、控制器重建后不重复执行、三阶段资源回收均已实测 |
| 可信分支推送检查 | 锁文件安装、云覆盖层与发布工具测试、双版本和上游 commit 校验 | push 触发与专属 self-hosted ECI runner 自动供给已实测，见接入手册 |
| 候选镜像 | 完整源码构建、两层镜像审计、原生 Linux 隔离启动/停机、发布已测产物、digest 绑定 | 完整构建、隔离 smoke、ACR 推送及产物上传已在 self-hosted runner 通过 |
| ACS 缓存 | 按目标网络准备主镜像和全部实际 init 镜像，检查精确引用与 Ready | 已实测 Ready 与同一 AK 的创建/Ready/非强制删除；每版实际镜像清单以回执为准 |
| 产品验收与晋级 | 记录明确的 pending 状态 | 完整 OAuth、DeviceLink、Pod 实际缓存命中、灰度、签名信任及稳定通道准入尚未自动化 |
| CIS 自动更新 | [双版本选择与主动升级](../DUAL-VERSION-UPDATES.md) | 已登记维护实例支持双版本；网页和原生客户端均已接入主动升级。统一稳定目录与新认领消费待接入 |

当前候选交付为 `0.1.113-cloud.2`，运行 [39731560933](https://github.com/zhuoshaojian/cindy/actions/runs/39731560933)
由版本提交的 **push** 自动触发：三个 job 按队列自动获得一次性 runner，完整构建、原生隔离
smoke、发布和 ACS 缓存全部成功，runner/ECI/JIT 自动回收；期间没有手工 dispatch、注册 runner
或补建缓存。详见 [自动供给与交付验收](ACCEPTANCE-AUTOSUPPLY-20261022.md)。

实例升级与候选交付分开：上一版 `0.1.113-cloud.1` 的本人实例维护升级见
[0.1.113 验收记录](../ACCEPTANCE-0113-20261022.md)；本次 `cloud.2` 没有切换实例或新认领默认，
也没有补做新的 OAuth/DeviceLink 验收。
历史实例升级与 init 修复见 [2026-10-21 验收](../ACCEPTANCE-CLOUD2-20261021.md)。
历史镜像、缓存和运行编号保留在对应验收记录，不作为当前发行输入。

## 哪些提交会执行什么

| 提交内容 | 自动行为 |
| --- | --- |
| 仅操作说明、README、验收记录 | 不触发本交付 workflow，不创建 runner、不构建、不发布、不创建 ACS 缓存 |
| 构建配方、运行时资源或交付工具变化，版本未变 | 只运行 `verify`，不交付镜像 |
| 同时更新 `delivery/version.json` 的合法云修订或上游版本 | `verify → candidate → cache`；发布前必须通过完整构建和隔离 smoke |
| 显式 `workflow_dispatch` | 手动请求完整候选交付，仍受分支、Environment、版本和不可变镜像门禁约束 |

纯文档排除规则写在 workflow 的 `push.paths`，不是等申请 runner 后再跳过发布。
`runtime-guidance/settings.md` 会进入应用正文，属于运行时资源，**不属于排除的说明文档**；
交付它的修改仍须递增云修订。文档与代码/版本混合提交时按实际代码/版本变化执行，
文档不会阻止应有的交付。显式手动触发不受 push 路径筛选约束。

本 workflow 产出候选和 ACS Ready 回执，不修改 CIS 控制面或任何实例。
CIS 自身的构建/部署与用户实例升级是另外两件事，见
[两仓交付边界](https://github.com/zhuoshaojian/cindy-server/blob/feat/cloud-settings-readonly/docs/cloud-instance/ci-cd-integration.md)。
两组 Environment 只放行本 fork 分支；ACR 与 ACS 使用独立 AK，不使用 OIDC。
配置见 [接入手册](BOOTSTRAP.md)，runner 的供给和回收见 [控制器说明](runner/README.md)。

## 双版本：上游完整版本 + 云修订

[`version.json`](version.json) 是提交到 Git 的发行意图。例如：

- 上游版本：`0.1.113`，完整保留 major/minor/patch；普通客户端源码版本不变。
- 云应用和发行版本：`0.1.113-cloud.2`；镜像标签：`0.1.113-cloud.2-cn-amd64`。
  云构建只在隔离导出目录写组合版本，应用内显示、ASAR、OCI 元数据与交付计划必须一致。
- 下次云改动：`0.1.113-cloud.3`；切换到 `0.1.114` 后：`0.1.114-cloud.1`。

同一上游修订必须加 1，新上游修订从 1 开始，禁止上游倒退和同名上游 tag 改 commit。
排序比较四个整数 `(major, minor, patch, cloudRevision)`，不使用整个字符串的 SemVer
或字典序。通道是独立字段，目前只输出 `candidate`。

这是新双版本编号的起点，**不把历史 R7 自动映射成 cloud.7，也不重标现有线上镜像**。
新上游还需更新冻结源码、补丁、依赖和配方并重新验收；检测到上游更新不等于可以发布。
当前完整配方仅支持显式的 `cn / linux/amd64`，其它组合拒绝构建，不伪造矩阵覆盖。

`version.json` 变化才会在可信分支推送时申请自动交付；相关代码提交只检查，纯说明文档不触发。
要交付的新配方必须同时提交修订号。重试不分配新版本：同 tag/config ID 已存在时复用，
不同产物拒绝覆盖。修复已发布候选必须新增修订。镜像仓库还须开启 tag 不可变策略，
不能仅依赖脚本的先查后写防并发。不得另推纯 `X.Y.Z` 或 `latest` 以绕过旧 CIS 选版逻辑。

镜像内同时保存 `io.cindy.upstream-version`、`io.cindy.cloud-revision`、
`org.opencontainers.image.version`，构建记录与 `candidate.json` 再绑定源码和 Registry digest。
本地 image config ID 用来证明推送的是已测产物；部署身份使用 Registry manifest digest。

## 执行链与凭据边界

1. `verify` 在 fork 仓库专属的临时 self-hosted Linux 运行，无发布凭据。
   本交付 workflow 只接受指定 fork 功能分支的 push/dispatch，不监听外部 PR；主仓工作流不变。
   fork 不必预先复制上游 tag：从 `makecindy/cindy` 拉取指定正式 tag，核对固定 commit，
   不使用上游最新分支或强制覆盖本地冲突 tag。
2. `candidate` 只接受上述 fork 和分支，在 `cloud-image-candidate-cn` 环境运行。
   使用新建 base + runtime 的 Bake 图，编译、瘦身和审计仍由现有完整 Dockerfile 完成。
   不继承历史 Cindy 成品镜像；中间构建层只写入私有构建缓存，不发布为云运行时版本。
3. `smoke.py` 使用一次性 tmpfs、无网络、只读根，模拟 root-owned 老 HOME 目录。
   初始化仅持有建测试目录所需权限，应用切到 UID 10001、清空 capabilities，执行镜像内
   原有 seccomp 入口。验证 Xfce/Plank、Cindy 可见窗口、renderer sandbox、正常停机。
   Docker 外层 seccomp/AppArmor 只在该一次性测试容器中交给运行时自带过滤器；不改变宿主
   系统策略、不使用 `--no-sandbox`、不代表业务身份就绪或 DeviceLink/OAuth 验收。
4. CLI 在构建前以普通用户安装到 job 临时目录，校验固定 SHA-256 和版本；不使用 sudo。
   构建前登录独立的私有构建缓存仓库；启动检查通过后重新登录候选仓库再发布。
   AK 只注入两个登录步骤，不传入 Dockerfile、build arg 或构建环境。可用 Registry 密码，或通过 ACR AK 换取
   一小时的临时 Registry 凭据。推送已测 image ID 并读取 Registry 原始 manifest，
   按 digest 再读回验证 config ID；不重建产物、不覆盖冲突标签。
5. GitHub artifact 保存候选记录、四份构建审计和 smoke 结果；不上传 HOME、密钥、整份
   构建上下文。跨 job 按不可变 artifact ID 传递，失败 job 重跑仍使用原产物。
6. `cache` 在独立 Environment 读取缓存 AK，创建/复用缓存。`cache-status.json` 只记录摘要、
   opaque cache ID 和结果，不公开 VSwitch / 安全组配置。`Ready` 仍保留
   `podMatchVerified: false` 和 `releaseApproved: false`。

缓存 API 每个请求只支持一个镜像，所以每个目标中按**精确引用**去重后逐个建缓存。
`$runtime` 展开为本轮精确引用。正常目标模板中的主容器与 Cindy init 均使用 `$runtime`，
见 [`acs-targets.example.json`](acs-targets.example.json)。现场发现旧 init 时须显式登记其
digest 以免漏算现状，同时登记并修复升级遗漏；缓存步骤没有修改实例模板的职责。
不要把现场旧引用复制成长期默认配置。由独立组件提供的 init 则使用其自身审核过的精确引用。
缓存发现、权限、网络或任一镜像失败即停止；超时可能仍在云端创建，重跑按同一请求 token
和缓存名称恢复，不自动删除重建。Ready 时再次核对镜像、Region、平台、网络及资源组。
缓存命中 probe 和生产准入仍需后续补齐，单凭回执不能切实例。

## fork 一次性配置

先配置再开开关；这些值不放在源码或聊天中。管理员操作和最小权限示例见
[首次接入手册](BOOTSTRAP.md)。

| 位置 | 名称 | 用途 |
| --- | --- | --- |
| Repository variable | `CLOUD_IMAGE_DELIVERY_ENABLED=true` | 开启可信分支候选交付 |
| Repository variable | `CLOUD_IMAGE_CACHE_ENABLED=true` | 开启候选发布后的缓存步骤 |
| `cloud-image-candidate-cn` variable | `CLOUD_IMAGE_REPOSITORY` | Registry 主机和仓库路径，不含 tag/digest |
| 同上 variable | `CLOUD_IMAGE_BUILD_CACHE_REPOSITORY` | 独立私有、允许更新标签的构建缓存仓库；不得等于候选仓库 |
| 同上 variable | `CLOUD_IMAGE_IMMUTABLE_TAGS=true` | 管理员确认仓库已启用 tag 不可变策略 |
| 同上 variable | `CLOUD_IMAGE_BUILDX_DRIVER_OPTS` | 可选，多行 BuildKit driver 选项；ECI 使用已验证的镜像 digest 和 `network=host`，见接入手册 |
| 同上 variable | `CLOUD_IMAGE_REGISTRY_AUTH` | `password`（默认）或 `acr-ak`；显式选择，不自动回退 |
| 同上 secrets | `CLOUD_IMAGE_REGISTRY_USER` / `CLOUD_IMAGE_REGISTRY_PASSWORD` | `password` 模式的 Registry 登录身份 |
| 同上 variable | `CLOUD_IMAGE_ACR_INSTANCE_ID` | `acr-ak` 模式的目标 ACR 企业版实例 |
| 同上 secrets | `CLOUD_IMAGE_ACR_ACCESS_KEY_ID` / `CLOUD_IMAGE_ACR_ACCESS_KEY_SECRET` | `acr-ak` 模式的 ACR 身份；仅在构建缓存和候选发布的登录步骤注入，见接入手册权限范围 |
| `cloud-image-cache-cn` secrets | `CLOUD_IMAGE_CACHE_ACCESS_KEY_ID` / `CLOUD_IMAGE_CACHE_ACCESS_KEY_SECRET` | 缓存 AK，仅在缓存步骤注入，与 ACR 身份独立 |
| 同上 secret | `CLOUD_IMAGE_CACHE_TARGETS` | 实际网络、允许的镜像仓库、完整主/init 模板清单 JSON |

两个 Environment 的部署分支限制均只放行 `feat/cloud-settings-native-client`；按团队政策
设置 reviewer。缓存 AK 按目标区域/账号授予 `acc:ListImageCaches`、
`acc:CreateImageCache`、`acc:GetImageCache`、`acc:DeleteImageCache`，预先准备服务关联角色。
发布流程负责创建和就绪检查；清理权限供独立的缓存维护使用，当前发布任务不会自动删除缓存。这里不需要
Kubernetes RRSA，不借用用户的控制台 Cookie。私有 ACR 拉取须预先配置可用权限；
当前适配器没有内联 Registry 密码字段，不要把凭据混进缓存配置。

所有 job 都使用 **repository-scoped、仅注册到 `https://github.com/zhuoshaojian/cindy`**
的临时 self-hosted runner。三个运行池标签分别为 `cindy-fork-cloud-check`、
`cindy-fork-cloud-build`、`cindy-fork-cloud-cache`，均包含 `self-hosted, Linux, X64`，
并绑定 `cindy-fork-run-<run_id>-<run_attempt>`；控制器按队列创建且完成后回收。
检查与缓存池不需要 Docker 特权；只有构建池使用独立 DinD。不得注册组织/企业级 runner，
不改主仓、企业运行池或现有 GitLab Runner。标签是调度标记，不是访问控制；运行池的
注册层级与 Environment 分支规则也须核验。

运行环境需要 Python ≥3.12、Git；构建池另需 Docker/Buildx，建议至少 4 vCPU、16 GiB RAM、
80 GiB 可用磁盘。可使用独立 VM 或 ACK 调度的临时 ECI，不挂宿主 HOME、Docker socket、
业务 PVC 或生产凭据；一个 job 后回收整套工作盘与凭据。此运行池不运行外部 PR，
也不与其共用缓存写入空间。跨 run 的 BuildKit 缓存见下节。
当前 fork 默认分支仍为 `main`。已实测通过 REST API 对 GitHub 已索引的
`cloud-image-delivery.yml` 指定 `feat/cloud-settings-native-client` 触发 `workflow_dispatch`，
无需改默认分支或向 main 推文件；网页按钮是否出现须另行核对。API 接受触发不等于交付成功；最新运行和限制见 [接入手册](BOOTSTRAP.md)。

## 构建缓存

临时 runner 不保留本地 Docker 磁盘。Buildx 把依赖基座和应用中间层以 `mode=max`
保存到同区域的私有 ACR 构建缓存仓库；新 runner 从这里恢复。两个标签按 fork 分支、
CN/amd64 和缓存格式隔离，base/runtime 分开写，records 只读，避免并发覆盖。
这些是构建缓存，不是新的云实例版本，不进入 CIS 或 ACS 镜像清单。

基座只读取 Dockerfile、包锁、包校验器和字体安装器四份输入，记录这组文件最后变更的
Git commit；修改交付文档、云修订号或应用补丁不再令 apt 安装重跑。应用侧也缩小了
构建上下文；完整提交记录在独立 records 阶段写入，云端指引和运行时代码仍参与打包
缓存校验。这些输入约束不代表跨 runner 的应用缓存复用已通过，实际限制见下文。
缓存命中仍执行发布审计、独立启动/停机验收和 digest 绑定。

首次构建、输入变更或缓存被清理时按完整 Dockerfile 重建。`--no-cache` 禁止导入旧缓存，
仍可导出新缓存；缓存导出失败不忽略。普通 cache mount 的下载目录不自动跨 runner 保存，
不能把它当成持久缓存；这里持久化的是可校验的构建层。
2026-10-21 完整镜像实测发现：全新 ECI 可以恢复基座缓存，但应用层在 `target:base`
边界之后仍重新执行，**完整应用缓存复用尚未验收通过**。缓存配置存在、导入成功或
小型 COPY 测试通过，都不能替代完整镜像计时。首次热测还遇到一次 ACR `429`，
BuildKit 会回退重建；不能把这种情况误报为热缓存命中。
实测方法、分项耗时和产物对比见 [冷/热构建验收记录](BUILD-CACHE-BENCHMARK.md)。
上述 2026-10-21 缓存基准只做构建与测量，没有重发当时已发布的 `cloud.1`。

实现依据：[Docker Registry cache](https://docs.docker.com/build/cache/backends/registry/)。

## 本地检查与后续验收

已有根依赖后，可运行：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s deploy/linux-desktop/delivery -p 'test_*.py' -v
node --test deploy/linux-desktop/delivery/*.test.mjs
python3 deploy/linux-desktop/delivery/plan.py --output /tmp/cindy-delivery-plan.json
# 使用 actionlint 1.7.7
actionlint -config-file deploy/linux-desktop/delivery/actionlint.yaml \
  .github/workflows/cloud-image-delivery.yml
```

完整的覆盖层、依赖基座和权限回归见 workflow 的 verify job。
离线测试覆盖数值排序/递增/降级、版本对与 digest 冲突、错误镜像证明、重复推送、
网络/鉴权读取失败、旧 init 遗漏、分页失败、缓存超时、Ready 错配及部分失败停止。
这些测试使用合成数据，不能当作真实 ACR/ACS 发布成功。

本轮 Linux 实测检查与发布结果见页首记录。默认配置统一主/init 镜像后，本地交付 Node
测试 13 项及文档检查 10 项通过；现场旧 init 的显式清点、缓存覆盖和失败停止测试仍保留。
此前扩展执行 `pnpm test:runner` 为 574 通过、6 失败、2 跳过；失败均来自既有
`design-inventory.test.mjs` 中 `/cloud-settings` 与 `/cloud-settings-trial` 的路由台账缺项，
对应 router、台账实现和测试与本轮修改前一致，未为此放宽门禁。

历史 init 升级遗漏已修复，证据见对应实例验收记录。每个新候选推广前仍须补齐完整功能、
真实 OAuth、DeviceLink、各模板的实际缓存命中和本人灰度记录；后续再接可信签名、长期发行目录及 CIS
统一选择器。当前 GitHub 产物保留 30 天，仅作候选交接，不能作为永久稳定发行目录。

官方依据：[GitHub 手动触发条件](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、
[ACS CreateImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-createimagecache)、
[ACS GetImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-getimagecache)。

### 云内应用版本

`version.json` 的上游版本与云修订号同时决定镜像标签、OCI 标签和 Electron 包版本。
包内 Cindy 的“关于”与运行期 `app.getVersion()` 显示 `0.1.113-cloud.2` 形式；镜像标签另附区域与架构。
发布检查读取实际 `app.asar` 的包版本并与发行计划比对，防止镜像已更新而云内仍只显示上游版本。
普通本地客户端的版本策略不变。
