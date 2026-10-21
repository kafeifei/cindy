# 云镜像自动交付（客户端 fork）

入口：[zhuoshaojian/cindy · feat/cloud-settings-native-client](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client)，
流水线：[cloud-image-delivery.yml](../../../.github/workflows/cloud-image-delivery.yml)。
这里属于 `cindy`；`cindy-server` 的 CIS 负责消费合格镜像、备份、升级和恢复。
本目录不会访问业务 PVC、修改实例或新认领默认。

## 已实现与尚未接通

| 阶段 | 本分支能力 | 启用/验收状态 |
| --- | --- | --- |
| PR / 分支推送检查 | 锁文件安装、云覆盖层与发布工具测试、双版本和上游 commit 校验 | 推送可触发，无云凭据 |
| 候选镜像 | 完整源码构建、两层镜像审计、原生 Linux 隔离启动/停机、发布已测产物、digest 绑定 | 代码已接入，须配置专用 runner 和 Environment；尚无本流水线真实构建记录 |
| ACS 缓存 | 遍历实际 Pod 模板中的主镜像和所有 init 镜像，按目标网络创建/复用并等待 Ready | 代码已接入，须配置 ACS 身份和模板清单；尚未真实调用 |
| 产品验收与晋级 | 记录明确的 pending 状态 | 完整 OAuth、DeviceLink、Pod 实际缓存命中、灰度、签名信任及稳定通道准入尚未自动化 |
| CIS 自动更新 | [双版本方案](../DUAL-VERSION-UPDATES.md) | 统一选择器和新认领消费尚未接入，不因 tag 存在就升级 |

2026-10-21 接入进度：已创建 `cloud-image-candidate-cn`、`cloud-image-cache-cn` 两个 Environment，
部署分支规则均只允许 `feat/cloud-settings-native-client`；两个交付开关当前保持 `false`。
当前 GitHub 页面显示 fork Actions 因使用规模被暂停，API 的 `enabled=true` 未反映该限制；
RAM 创建 OIDC provider 返回 `NoPermission`（`ram:CreateOIDCProvider`）。
专用 runner、Registry 凭据、RAM OIDC 和首次真实运行仍待完成。环境存在不代表交付已通过；
后续以实际 workflow run、镜像 digest 和缓存回执更新此状态。
目标 ACK + ECI 的 DinD、Buildx 实际构建/运行、已发布 R7 的桌面启动/沙箱/停机已通过，
测试 Job 和临时命名空间已清理。ECI 到 GitHub 的 HTTPS 连接仍被拒绝，尚未注册 runner，
也未在此运行池从完整 Dockerfile 构建新候选；配置与实测边界见
[接入手册](BOOTSTRAP.md#ack--eci-接入)。

## 双版本：上游完整版本 + 云修订

[`version.json`](version.json) 是提交到 Git 的发行意图。例如：

- 应用版本：`0.1.108`，完整保留上游的 major/minor/patch，不改 `package.json`。
- 云发行版本：`0.1.108-cloud.1`；镜像标签：`0.1.108-cloud.1-cn-amd64`。
- 下次云改动：`0.1.108-cloud.2`；切换上游后：`0.1.109-cloud.1`。

同一上游修订必须加 1，新上游修订从 1 开始，禁止上游倒退和同名上游 tag 改 commit。
排序比较四个整数 `(major, minor, patch, cloudRevision)`，不使用整个字符串的 SemVer
或字典序。通道是独立字段，目前只输出 `candidate`。

这是新双版本编号的起点，**不把历史 R7 自动映射成 cloud.7，也不重标现有线上镜像**。
新上游还需更新冻结源码、补丁、依赖和配方并重新验收；检测到上游更新不等于可以发布。
当前完整配方仅支持显式的 `cn / linux/amd64`，其它组合拒绝构建，不伪造矩阵覆盖。

`version.json` 变化才会在可信分支推送时申请自动交付；普通代码/文档提交只检查。
要交付的新配方必须同时提交修订号。重试不分配新版本：同 tag/config ID 已存在时复用，
不同产物拒绝覆盖。修复已发布候选必须新增修订。镜像仓库还须开启 tag 不可变策略，
不能仅依赖脚本的先查后写防并发。不得另推纯 `X.Y.Z` 或 `latest` 以绕过旧 CIS 选版逻辑。

镜像内同时保存 `io.cindy.upstream-version`、`io.cindy.cloud-revision`、
`org.opencontainers.image.version`，构建记录与 `candidate.json` 再绑定源码和 Registry digest。
本地 image config ID 用来证明推送的是已测产物；部署身份使用 Registry manifest digest。

## 执行链与凭据边界

1. `verify` 在 GitHub hosted Linux 运行，无发布凭据；PR 不进入自建 runner。
   fork 不必预先复制上游 tag：从 `makecindy/cindy` 拉取指定正式 tag，核对固定 commit，
   不使用上游最新分支或强制覆盖本地冲突 tag。
2. `candidate` 只接受上述 fork 和分支，在 `cloud-image-candidate-cn` 环境运行。
   使用新建 base + runtime 的 Bake 图，编译、瘦身和审计仍由现有完整 Dockerfile 完成。
   不继承历史 Cindy 成品镜像，也不向 Registry 推送中间构建层。
3. `smoke.py` 使用一次性 tmpfs、无网络、只读根，模拟 root-owned 老 HOME 目录。
   初始化仅持有建测试目录所需权限，应用切到 UID 10001、清空 capabilities，执行镜像内
   原有 seccomp 入口。验证 Xfce/Plank、Cindy 可见窗口、renderer sandbox、正常停机。
   Docker 外层 seccomp/AppArmor 只在该一次性测试容器中交给运行时自带过滤器；不改变宿主
   系统策略、不使用 `--no-sandbox`、不代表业务身份就绪或 DeviceLink/OAuth 验收。
4. 启动检查通过后才注入 Registry 凭据，推送已测 image ID 并读取 Registry 原始 manifest，
   按 digest 再读回验证 config ID；不重建产物、不覆盖冲突标签。
5. GitHub artifact 保存候选记录、四份构建审计和 smoke 结果；不上传 HOME、密钥、整份
   构建上下文。跨 job 按不可变 artifact ID 传递，失败 job 重跑仍使用原产物。
6. `cache` 在独立环境取得 STS 临时身份，创建/复用缓存。`cache-status.json` 只记录摘要、
   opaque cache ID 和结果，不公开 VSwitch / 安全组配置。`Ready` 仍保留
   `podMatchVerified: false` 和 `releaseApproved: false`。

缓存 API 每个请求只支持一个镜像，所以每个目标中按**精确引用**去重后逐个建缓存。
`$runtime` 展开为本轮精确引用，保留旧 init 的模板必须登记旧镜像 digest，不能一律替换。
新认领、verified profile、legacy native 三种模板见
[`acs-targets.example.json`](acs-targets.example.json)，使用前必须换成实际模板清单。
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
| 同上 variable | `CLOUD_IMAGE_IMMUTABLE_TAGS=true` | 管理员确认仓库已启用 tag 不可变策略 |
| 同上 secrets | `CLOUD_IMAGE_REGISTRY_USER` / `CLOUD_IMAGE_REGISTRY_PASSWORD` | 只允许候选仓库读/推送的身份，禁用删除及生产部署权限 |
| `cloud-image-cache-cn` variables | `ACS_CACHE_RAM_ROLE_ARN` / `ACS_CACHE_OIDC_PROVIDER_ARN` | GitHub OIDC 换 STS 的专用缓存角色 |
| 同上 secret | `CLOUD_IMAGE_CACHE_TARGETS` | 实际网络、允许的镜像仓库、完整主/init 模板清单 JSON |

两个 Environment 的部署分支限制均只放行 `feat/cloud-settings-native-client`；按团队政策
设置 reviewer。RAM OIDC 信任绑定该 repository、cache Environment 和
`sts.aliyuncs.com` audience；只授予目标区域/账号所需的 `acc:ListImageCaches`、
`acc:CreateImageCache`、`acc:GetImageCache`，预先准备服务关联角色。这里不需要
Kubernetes RRSA，不借用用户的控制台 Cookie。私有 ACR 拉取须预先配置可用权限；
当前适配器没有内联 Registry 密码字段，不要把凭据混进缓存配置。

runner 标签为 `self-hosted, Linux, X64, cindy-cloud-build`，用专用、临时原生 amd64 Linux，
安装 Docker/Buildx、Python ≥3.12、Git；建议至少 4 vCPU、16 GiB RAM、80 GiB 可用磁盘。
可使用独立 VM 或 ACK 调度的临时 ECI；执行资源和身份与业务工作负载隔离，测试结束回收，
不挂宿主 HOME、Docker socket、业务 PVC 或生产凭据。只有这个可信
workflow 可以用该 runner；不可给任意 fork PR 或其它 workflow 开放。依赖下载和构建
缓存不应共用不可信 PR 的缓存写入空间。本版复用单次 Bake 的缓存，尚未加入跨 run
外部 BuildKit 缓存，也不自动修改 runner 的宿主安全策略。

当前 fork 默认分支仍为 `main`；GitHub 的 `workflow_dispatch` 要求 workflow 先存在于
默认分支。本轮不改默认分支，也不往 main 推文件，因此初次启用使用本功能分支的 push
触发，失败后可重新运行原 run。不要承诺刚提交功能分支就能从 Actions 手动启动。

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

本次本地验证（2026-10-21，macOS）：Node 云覆盖层/交付测试 121 通过、1 跳过
（Bash 5.1 Linux 停机测试）；Python 配方/依赖基座/字体/交付测试共 56 通过；
文档检查 10 通过；actionlint 1.7.7 通过。已实际从官方仓库读取上游 tag 并核对固定 commit。
上述是 macOS 离线检查。后续新增的 ECI 实测已验证现有 R7 的 native smoke，详情见
[验收记录](BOOTSTRAP.md#ack--eci-接入)；修正后的交付 Python 测试 15 项通过，文档检查
10 项及 actionlint 通过。它仍不代表新候选已完成源码构建或首次 GitHub 交付。
扩展执行 `pnpm test:runner` 为 574 通过、6 失败、2 跳过；失败均来自既有
`design-inventory.test.mjs` 中 `/cloud-settings` 与 `/cloud-settings-trial` 的路由台账缺项，
对应 router、台账实现和测试与本轮修改前一致，未为此放宽门禁。

上线前还须完成第一轮真实 CI 构建和缓存运行，补上完整原生 Linux 功能、真实 OAuth、
DeviceLink、各模板的实际缓存命中和本人灰度记录；再接可信签名、长期发行目录及 CIS
统一选择器。当前 GitHub 产物保留 30 天，仅作候选交接，不能作为永久稳定发行目录。

官方依据：[GitHub 手动触发条件](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、
[ACS CreateImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-createimagecache)、
[ACS GetImageCache](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-getimagecache)。
