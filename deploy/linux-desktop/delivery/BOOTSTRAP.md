# fork 交付环境接入

本页是 [交付流水线](README.md) 的首次配置手册；配置完成和真实运行通过是两件事。
镜像仍只交付 candidate，不修改 CIS、实例、新认领默认或稳定版本。

## GitHub 启用与 Environment

仓库：`zhuoshaojian/cindy`；可信分支：`feat/cloud-settings-native-client`。

先登录仓库 Actions 页面，区分普通 fork 暂停与 GitHub 平台禁用。`actions/permissions`
返回 `enabled: true` 不能排除后者。2026-10-21 未登录页面只提示使用规模导致暂停；
维护者登录后实际显示 **“GitHub Actions is currently disabled for this repository”**，
并要求联系 [GitHub Support](https://support.github.com/contact?tags=dotcom-actions)，没有启用按钮。
此状态须由仓库所有者联系 Support 解除；不要反复修改 API 开关、默认分支或推送试探，
也不要把无 run 记录当作检查通过。

创建两个 Environment，均配置 **Selected branches and tags → branch**，精确允许
`feat/cloud-settings-native-client`，不添加 tag 通配规则：

- `cloud-image-candidate-cn`：镜像仓库配置与专用推送身份。
- `cloud-image-cache-cn`：缓存角色、OIDC provider 和实际网络/模板清单。

变量与 Secret 名称见 [README 配置表](README.md#fork-一次性配置)。配置完成前两个开关均为
`false`。`workflow_dispatch` 仍要求工作流先存在于默认分支；本功能分支以 push 验证触发链。
如果首个版本提交发生在 Actions 暂停期间，应先让检查实际运行，再安排一次明确的交付触发；
不要为了测试触发而反复递增云版本号或发布占位镜像。

## RAM 管理员一次性配置

以下使用占位符，替换后在管理端执行。**管理员身份与流水线运行身份分开**：运行身份不需要
创建用户、角色、权限策略、OIDC provider 或服务关联角色，也不需要 ECS/Kubernetes/OSS 权限。
若配置操作返回 `NoPermission`，交给账号管理员执行，不借用业务服务的凭据。

1. 创建名为 `cindy-github-actions` 的 OIDC provider：issuer 为
   `https://token.actions.githubusercontent.com`，客户端 ID 为 `sts.aliyuncs.com`。
   使用 RAM 控制台的“验证指纹”读取并校验当前 TLS 证书，不复制历史文章中的指纹。
2. 创建 `cindy-cloud-image-cache-cn` 角色，最大会话为 3600 秒，信任策略如下。
   `ACCOUNT_ID` 替换为实际账号，issuer、audience 和 subject 必须精确匹配。
   GitHub 环境分支规则必须先配置；使用 Environment 时 subject 不包含 branch。

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Principal": {"Federated": ["acs:ram::ACCOUNT_ID:oidc-provider/cindy-github-actions"]},
    "Condition": {"StringEquals": {
      "oidc:iss": "https://token.actions.githubusercontent.com",
      "oidc:aud": "sts.aliyuncs.com",
      "oidc:sub": "repo:zhuoshaojian/cindy:environment:cloud-image-cache-cn"
    }}
  }]
}
```

3. 为该角色附加下面的自定义权限策略。三项 API 均支持 imagecache 资源范围；只开放目标
   Region 和账号，不授予删除缓存或修改集群的权限。缓存 ID 是创建后分配，资源末尾需为 `*`。
   ACS 缓存所需服务关联角色由管理员预先准备，不给 CI 添加 `ram:CreateServiceLinkedRole`。

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["acc:ListImageCaches", "acc:CreateImageCache", "acc:GetImageCache"],
    "Resource": "acs:acc:cn-shanghai:ACCOUNT_ID:imagecache/*"
  }]
}
```

4. 将实际 role/provider ARN 填进 cache Environment 的两个变量。网络与主/init 镜像清单
   放入 `CLOUD_IMAGE_CACHE_TARGETS` Secret，格式见 [示例](acs-targets.example.json)。
   所有实际 init 都要登记；不要把 legacy init 自动改成新 runtime。策略不支持按缓存名称或
   网络进一步缩小这三项 API 的资源授权，网络约束由受保护的 Environment 配置与适配器校验。

管理员需要的配置操作为 `ram:CreateOIDCProvider`、`ram:CreateRole`、`ram:CreatePolicy`、
`ram:AttachPolicyToRole` 及相应读取操作；这些权限无需授给流水线角色。

## 镜像仓库与推送身份

选择专用候选仓库，并在 ACR 读取确认 **Tag 不可变** 后才设置
`CLOUD_IMAGE_IMMUTABLE_TAGS=true`。不可变策略会影响整个仓库，不为试跑而修改其它业务仓库。
ACR 的不可变策略对 `latest` 有例外，本流水线不产生该标签。

给专用 RAM 推送用户如下权限；替换账号、ACR 实例、命名空间和仓库名：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["cr:PullRepository", "cr:PushRepository"],
    "Resource": "acs:cr:cn-shanghai:ACCOUNT_ID:repository/INSTANCE_ID/NAMESPACE/REPOSITORY"
  }]
}
```

ACR 推送身份必须来自**该 Registry 所属账号**；ACS 缓存角色来自缓存所属账号，两者可能不同。
2026-10-21 用户指定的本地 ACR AK 已验证可管理目标实例，补建了独立、公开且 tag 不可变的
候选仓库，未改变正式仓库的策略。AK 已写入 candidate Environment Secret；只允许
`feat/cloud-settings-native-client` 分支。本机完成临时 Registry 登录、测试制品推送、
匿名读取和同标签覆盖拒绝，测试标签已清理，尚未通过 GitHub Actions 执行。现有 AK 的 RAM 身份管理查询
返回 `NoPermission`；这不代表缺少 ACR 权限，也不能将其宣称为新建的最小权限身份。

`CLOUD_IMAGE_REGISTRY_AUTH` 显式选择两种方式：

- `password`（默认）：设置 `CLOUD_IMAGE_REGISTRY_USER` 和 `CLOUD_IMAGE_REGISTRY_PASSWORD`，
  值为该身份的 Registry 登录凭据，不是 RAM AK。不上传个人 Docker 的全局配置。
- `acr-ak`（当前 fork）：设置 `CLOUD_IMAGE_ACR_INSTANCE_ID`、
  `CLOUD_IMAGE_ACR_ACCESS_KEY_ID` 与 `CLOUD_IMAGE_ACR_ACCESS_KEY_SECRET`。最后两个为
  Environment Secret。发布前通过 `GetAuthorizationToken` 换取一小时临时凭据，不把临时
  token 当长期 GitHub Secret。除目标仓库的 Pull/Push 权限，运行身份还需要：

```json
{"Effect":"Allow","Action":["cr:GetAuthorizationToken"],"Resource":"*"}
```

该 API 不支持资源级授权；实际 Registry 权限继承调用身份，临时 token 不自动收窄
原 AK 的权限。管理员建立专用身份时，按前述 Pull/Push 策略限定候选仓库，另加此项。
当前用户提供的 AK 只用于已授权的 fork 交付配置，不扩展到 ACS/OSS、其它仓库或业务服务。

实现为 [registry_login.py](registry_login.py)，回归为 [test_registry_login.py](test_registry_login.py)。
CLI 3.5.0 的 API 路径在加载 AK 环境变量前校验 profile；脚本因此在系统/runner 临时目录
创建 0700 目录和 0600 vendor profile，换取 token 后立即清除，不读写默认 `~/.aliyun`。
AK 不进入命令参数、源码、日志或 artifact；Docker 只通过 stdin 接收临时密码，
只写当前 job 的 `DOCKER_CONFIG`，由 workflow 的 always 清理步骤删除登录配置。
两种鉴权方式不会因失败自动切换；错误仅输出固定错误码，CLI 响应正文不外泄。
ACS 的 [STS 调用](acs-api.mjs) 同样使用临时 vendor profile，保留 OIDC 换取的
短期凭据和独立缓存身份，不复用 ACR AK；每次调用成功或失败后都清理。
真实 CLI 3.5.0 已用假 STS 凭据和本地回环模拟服务验证请求签名、响应解析与默认 profile
不被修改；模拟连接不涉及云服务，生产仍强制 HTTPS。这不替代真实 ACS 权限和创建缓存验收。
依据：[ACR 临时凭据与权限继承](https://help.aliyun.com/zh/acr/developer-reference/api-cr-2018-12-01-getauthorizationtoken)。

当前缓存适配器不接收 Registry 密码。私有候选仓库必须先接通 ACS 的 ACR 拉取授权；
不能通过将仓库改公开来绕过已有私有策略。已有公开交付仓库则继续按原公开策略。

## 原生 Linux runner

需要独立的 Linux x86_64 执行环境，Docker/Buildx、Python ≥3.12、Git，建议 4 vCPU / 16 GiB /
80 GiB 可用磁盘。可以使用一次性 VM，也可以由现有 ACK 调度一次性 ECI 作业；不要求额外
购买常驻 ECS。不得将业务 Kubernetes 节点、业务实例或个人 Mac 注册为此 runner。
用 GitHub **ephemeral runner**，只执行一个 job 后退出，再回收整个 VM 或 ECI 作业及工作盘；
不复用上一次 job 的 Docker、HOME、凭据或缓存目录。runner 注销不等于 ECI 已停止，
还须处理 Docker sidecar 的退出、任务超时和异常回收。

### ACK + ECI 接入

先核对现有 Runner 的生效配置和实际 ECI 作业，不因文档标注内测就推断目标账号未开通。
2026-10-21 已在目标 ACK 的独立临时命名空间完成原生 `x86_64` 验收，使用 4 vCPU /
16 GiB 和 100 GiB 临时存储；没有修改现有 GitLab Runner 或云实例。

| 验收项 | 实测结果 |
| --- | --- |
| ECI 特权能力 | tmpfs 挂载、写入、卸载通过 |
| DinD / Buildx | Docker 29.9.1（overlay2）、Buildx 0.38.0、BuildKit 0.30.0；实际构建含 cache mount 的小镜像，加载并运行通过 |
| 镜像搬运 | 官方 DinD、Python 3.12 slim-bookworm、BuildKit 的 amd64 manifest 搬至已有 public 命名空间；manifest、config、layers 一致，ECI 拉取通过 |
| 已发布 R7 启动 | `smoke.py` 验证 Xfce/Plank、Cindy 可见窗口、root-owned 老 HOME、UID 10001 渲染进程、零 capabilities、NoNewPrivs 与 seccomp 通过 |
| 隔离与停机 | 无网络、只读根、合成 tmpfs 数据；Cindy 正常退出，验收容器和 DinD 均退出 0，重启次数 0；Job 与临时命名空间已清理 |

测试对象为 `0.1.108-source-r7.20261020`：

```text
Registry manifest: sha256:76d51e58368b53870df9a9b5018659e56cd1e9fc67d81dffaa8a43e8986e560d
Image config:      sha256:715e2d8a03b778c877806579c205ca6088eb1dce092467093598eaf84a9dcb70
```

这是运行池资格验收，**未在此运行池从完整 Cindy Dockerfile 构建新候选**，也不是 GitHub
真实交付、OAuth 或 DeviceLink 验收。GitHub 出站已完成分路径诊断（见下文），
尚未达到完整交付验收；ACR 发布鉴权已另行接通，Actions 平台禁用与 ACS OIDC 配置仍待解决。
启动探针的目录初始化和进程识别修正已纳入源码与回归测试。

- GitHub runner 管理组件与 ECI 作业使用独立 namespace、ServiceAccount 和凭据；沿用
  现有 ECI 调度方式，不修改现有 GitLab Runner，也不复用其注册或缓存身份。
- ECI 作业 Pod 使用 `alibabacloud.com/eci: "true"` 标签；工作目录和 Docker 数据目录
  使用本次作业的临时卷。按实测峰值配置临时存储，不挂宿主 Docker socket 或业务 PVC。
- 当前 workflow 需要 Docker daemon，采用 DinD 时只向其构建容器授予所需特权。
  runner 使用共享 Unix socket 或受保护连接访问 daemon，不对外暴露 Docker API。
  完整验收须仍验证镜像中的 UID 10001、无 capabilities 和 seccomp，不能放宽应用沙箱。
- 接入前实际运行 Docker/Buildx、完整 Dockerfile 和 `smoke.py`，确认嵌套运行及清理可用。
  通过后才将该运行池用于真实候选交付，不能以 Runner 显示 online 替代这些检查。

### 依赖镜像与构建网络

本交付链使用 Docker image ID 作为 config digest。Docker 29 新安装默认启用
[containerd image store](https://docs.docker.com/engine/storage/containerd/)，本次实测触发了
config ID 不一致门禁；尚未兼容该后端。此运行池的 DinD
须显式设置 `--feature=containerd-snapshotter=false --storage-driver=overlay2`，并在构建前
核对 `docker info` 的 Driver 为 `overlay2`。这是一次性 runner 的存储配置，不修改 Cindy
镜像、不放宽已测产物与 Registry config 的一致性校验，也不调整共享 Docker daemon。
后续切换后端须同时适配构建、smoke 和发布记录，不能只改某处摘要比较。

ECI 无法拉取 Docker Hub 时，可由已有登录的开发机将**官方精确 digest**搬到自有镜像
仓库，再让 ECI 按搬运后的 digest 拉取。使用追加的版本/架构标签，保留源映射；不覆盖
旧标签、不换成来源不明的旧基座。公开依赖可以放在已有 `public` 命名空间，私有产物
仍保留原访问策略。开发机的个人 Registry 登录只用于本次搬运，不注入 runner。

例如使用 `crane copy --no-clobber "$source_ref" "$mirror_tag"` 保留 manifest，随后核对
两端 `crane digest`、config 与全部 layer digest 一致；再验证目标访问方式。验证范围
须包括外层 DinD/runner 镜像、DinD 内的 BuildKit 镜像和 Dockerfile 的基础镜像。
只搬外层镜像不能解决内部构建仍访问 Docker Hub 的问题。

本次 ECI 实测中，DinD 默认 bridge 内的 BuildKit 无法访问集群 DNS。使用
`docker buildx create --driver docker-container --driver-opt "image=$buildkit_ref" --driver-opt network=host`
后，镜像解析和实际构建通过。这里的 `host` 是**本次 ECI Pod 的网络命名空间**，
不是 ACK 节点；Pod 不设置 `hostNetwork`，Cindy smoke 仍使用 `--network=none`。
workflow 通过受保护的 candidate Environment 变量 `CLOUD_IMAGE_BUILDX_DRIVER_OPTS`
接入这些选项，每行一个；不用 ECI 时可留空。ECI 示例（仓库地址用实际镜像替换）：

```text
image=registry.example.com/public/buildkit@sha256:57269d1784e49b46228c45a1a1b870fbe40e0a639ab60b37b032d83af5bccdfc
network=host
```

这只配置 BuildKit 的镜像和网络，不创建 runner，也不改变 Pod DNS。

### ECI 出站与 CustomDNSConfig

`CustomDNSConfig` CR 修改的是 ACK 托管 DNS 的共享规则；
`k8s.aliyun.com/eci-custom-dnsconfig` annotation 则作用于单个 ECI Pod，二者不同。
DNS 可将域名指向现有 SNI 转发服务，但不会创建代理、打开监听端口或配置 HTTP CONNECT。
先读现有规则、检查 `/etc/resolv.conf`，再分别验证 DNS、TCP、TLS 和真实下载。

2026-10-21 独立作业实测：

| 路径 | 结果 |
| --- | --- |
| ECI 默认 ClusterFirst | 共享 `CustomDNSConfig/default` 将 GitHub 指向内网代理，连接 443 被拒绝 |
| 独立 ACK 普通 Pod 对照 | 同一个代理路径也被拒绝；不能归因于 ECI 专有问题 |
| ECI 单 Pod 自定义 DNS | GitHub 首页/API、codeload、GHCR、Actions 控制端点通过 TLS；Action 压缩包完整下载，runner 安装包前 64 KiB 分段下载通过 |
| raw.githubusercontent.com | 普通解析访问仍重置；四个地址中仅一个定向测试成功，不应固定 CDN IP 作为修复 |

以下是本次验证的 **Pod 模板片段**，不修改共享 DNS，也不宣称它是完整网络修复：

```yaml
metadata:
  labels:
    alibabacloud.com/eci: "true"
  annotations:
    k8s.aliyun.com/eci-image-cache: "false"
    k8s.aliyun.com/eci-custom-dnsconfig: '{"nameservers":"100.100.2.136,100.100.2.138","options":"ndots:1,timeout:2,attempts:1"}'
spec:
  dnsPolicy: Default
  automountServiceAccountToken: false
```

实测容器使用了这两个 nameserver，但 ECI 将有效 `ndots` 设为 `6`，应以容器内结果为准。
此方式不经集群 DNS，不能假定它仍解析 Kubernetes Service；需要集群服务的任务应另验分域
解析。本次临时作业不依赖业务 Service、PVC 或凭据。Annotation 说明见
[阿里云 ECI 自定义 DNS](https://help.aliyun.com/zh/eci/user-guide/configure-custom-dns-for-eci-pods)。

完整交付仍须修复内网代理的 443 路径或提供可用的专用出站代理，并从 runner 进程及
BuildKit 内分别验证下载。显式 HTTP 代理需要真实的 `https_proxy` / `http_proxy` 与
`no_proxy` 配置；不能把 DNS 服务器地址直接当 HTTP 代理。保留 TLS 校验，不将 CDN IP
写进永久 hosts，不把个人代理凭据放入源码。

按 [GitHub 官方出站域名清单](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#requirements-for-communication-with-github)
覆盖注册/领任务、Actions 下载和 artifact 传输。根路径返回经过 TLS 验证的 404 仅证明
该端点可达；不能替代 runner 注册、真实 job 或 artifact 上传。

三个 job 分别调度 `self-hosted, Linux, X64` 加以下标签：

| job | 专属标签 | 权限 |
| --- | --- | --- |
| verify | `cindy-fork-cloud-check` | 无云发布凭据、无 Docker 特权 |
| candidate | `cindy-fork-cloud-build` | 独立 DinD；最后发布步骤读取 candidate Environment |
| cache | `cindy-fork-cloud-cache` | 无 Docker 特权；cache Environment 的 OIDC 最小权限 |

runner **只注册到 fork 仓库 `https://github.com/zhuoshaojian/cindy`**，不注册组织或企业，
不借用主仓、企业或已有 GitLab Runner。标签本身不是授权边界；核对注册 URL、仓库归属、
短期注册/JIT token 和每个实例的单次 job 生命周期。创建 token/runner 的凭据不交给构建
进程，runner 不挂业务凭据。只接收指定 fork 分支的 push/dispatch；本工作流不监听 PR，
不把外部 PR 自动送入该 VPC 运行池。若需要持续自动供给，应在独立 namespace 配置
按需创建与回收，不用长期在线、共享数据的机器代替。

准备完成后核对 runner 架构、Docker daemon 架构和磁盘；再打开交付开关，让本次受信任
运行完成完整构建、原生 smoke、推送和缓存 Ready。记录 workflow URL、recipe commit、
双版本号、image config ID、Registry digest 和各主/init 缓存结果。环境配置成功不能代替
首次真实交付；缓存 Ready 不能代替 Pod 命中或完整产品验收。

依据：[GitHub runner 隔离与 JIT](https://docs.github.com/en/actions/reference/security/secure-use)、
[OIDC subject](https://docs.github.com/en/actions/reference/security/oidc)、
[ACR 权限资源](https://www.alibabacloud.com/help/en/acr/user-guide/ram-authorization-information)、
[ACR 标签不可变](https://www.alibabacloud.com/help/en/acr/user-guide/turn-on-immutable-image-version)、
[ACS 创建缓存](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-createimagecache)、
[ACS 查询列表](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-listimagecaches)、
[ACS 查询详情](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-getimagecache)。
