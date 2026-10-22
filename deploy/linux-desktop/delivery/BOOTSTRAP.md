# fork 交付环境接入

本页是 [交付流水线](README.md) 的首次配置手册；配置完成和真实运行通过是两件事。
镜像仍只交付 candidate，不修改 CIS、实例、新认领默认或稳定版本。

## GitHub 启用与 Environment

仓库：`zhuoshaojian/cindy`；可信分支：`feat/cloud-settings-native-client`。

Actions 已启用，运行只接受本 fork 的上述分支。首次候选交付运行为
[39566954585](https://github.com/zhuoshaojian/cindy/actions/runs/39566954585)，
镜像、检查与实测边界集中记录在 [README](README.md#已实现与尚未接通)。
CLI 在构建前验证，校验固定安装包并安装到 job 临时目录，不要求提权。
不需要修改主仓、默认分支或企业 runner。

持续队列供给已部署，版本提交后的完整无人介入交付见
[2026-10-22 验收](ACCEPTANCE-AUTOSUPPLY-20261022.md)；控制器配置方式见
[runner 部署与维护](runner/README.md#部署与维护)。

创建两个 Environment，均配置 **Selected branches and tags → branch**，精确允许
`feat/cloud-settings-native-client`，不添加 tag 通配规则：

- `cloud-image-candidate-cn`：镜像仓库配置与专用推送身份。
- `cloud-image-cache-cn`：缓存 AK 和实际网络/模板清单。

变量与 Secret 名称见 [README 配置表](README.md#fork-一次性配置)。配置完成前两个开关均为
`false`。本 fork 两个 Environment 的配置与分支限制已完成；独立 AK 实测创建缓存、达到
Ready、以 `Force=false` 删除及查询无残留均通过后，两个开关已开启。

已实测 REST API 对本分支 workflow 指定 `ref` 触发 `workflow_dispatch`，无需改默认分支；
网页是否显示 Run workflow 按钮应另行核对。不要为了测试触发而反复递增云版本号或发布
占位镜像。完整交付成功以镜像及缓存回执为准，不以 API 接受请求为准。

## ACS 缓存账号：AK 与权限

缓存直接使用 AK 调用 OpenAPI，不配置 OIDC provider、角色信任策略或 STS 交换。
ACR 与 ACS 可以属于不同账号，必须独立配置；不复用 candidate Environment 的 ACR 凭据。

1. 在缓存所属账号，为获准用于交付的 RAM 用户附加以下自定义策略。
   将 `ACCOUNT_ID` 替换为实际账号，Region 按目标调整。

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["acc:ListImageCaches", "acc:CreateImageCache", "acc:GetImageCache", "acc:DeleteImageCache"],
    "Resource": "acs:acc:cn-shanghai:ACCOUNT_ID:imagecache/*"
  }]
}
```

2. 在 `cloud-image-cache-cn` Environment 配置 Secrets：
   `CLOUD_IMAGE_CACHE_ACCESS_KEY_ID`、`CLOUD_IMAGE_CACHE_ACCESS_KEY_SECRET`。
   仅缓存步骤读取；不写入仓库、命令参数、日志或 artifact。
3. 将实际网络和主/init 镜像清单存为 `CLOUD_IMAGE_CACHE_TARGETS` Secret，格式见
   [示例](acs-targets.example.json)。主容器与 Cindy init 的正常目标使用同一 `$runtime`。
   清点中发现旧 init 时显式登记现状并修复 CIS 升级遗漏，不把旧镜像留作长期默认；
   缓存步骤本身不修改实例模板。
4. 用同一身份验收查询、创建、Ready 和清理，再开启 `CLOUD_IMAGE_CACHE_ENABLED`。
   删除权限供缓存维护使用，发布流程不会自动删除已有缓存；删除使用 `Force=false`，
   先核对所属交付和保留范围，不删除正在使用或仍须保留的回退镜像缓存。

以上四项 API 的范围限于 imagecache；无需额外授权修改集群、ECS 或 OSS。
已有 ACS 服务关联角色可直接复用；若账号首次使用缓存，由管理员创建服务关联角色。
该初始化操作需要下列权限，日常缓存 AK 不需要 RAM 管理权限：

```json
{
  "Effect": "Allow",
  "Action": "ram:CreateServiceLinkedRole",
  "Resource": "*",
  "Condition": {"StringEquals": {"ram:ServiceName": "imc.acc.aliyuncs.com"}}
}
```

依据：[ACS API 授权信息](https://help.aliyun.com/zh/cs/api-acc-2024-04-02-ram)、
[服务关联角色](https://www.alibabacloud.com/help/en/ram/developer-reference/aliyuncsmanagedimagecachediskrolepolicy)。

## ACR 仓库账号：镜像仓库与推送身份

云运行时统一发布到 `cloud-runtime-cn`，并在 ACR 读取确认 **Tag 不可变** 后才设置
`CLOUD_IMAGE_IMMUTABLE_TAGS=true`。不可变策略会影响整个仓库，不为试跑而修改其它业务仓库。
ACR 的不可变策略对 `latest` 有例外，本流水线不产生该标签。

另外为临时 runner 创建一个**私有构建缓存仓库**，允许更新缓存标签，配置到
`CLOUD_IMAGE_BUILD_CACHE_REPOSITORY`。它与运行时仓库分开，沿用 ACR 登录身份并单独授予
该缓存仓库 Pull/Push 权限；不要关闭运行时仓库的不可变策略。此仓库可能包含构建中间源码，
不开放匿名读取。缓存可清理并从源码重建，不能登记为实例镜像或加入 ACS 运行时缓存。

ACK/ECI 构建池应先验证 ACR VPC 端点可达，再将同一个缓存仓库的 VPC 引用配置到
`CLOUD_IMAGE_BUILD_CACHE_REPOSITORY`。核对公网/VPC 两端的缓存 manifest 和 layer digest
一致，并验证实际层下载转到 OSS 内网；只有 `/v2/` 返回 401 不足以证明完整链路可用。
这是访问路径配置，不迁移仓库、不重建缓存，也不修改运行时双标签的公开引用。
本机不在该 VPC 时仍使用公网端点。参见
[ACR VPC 访问配置](https://www.alibabacloud.com/help/en/acr/user-guide/configure-access-over-vpcs)。
构建前的登录供 BuildKit 读写缓存，smoke 后再换取新的短期凭据发布候选，AK 不进入构建层。

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

ACR 推送身份必须来自**该 Registry 所属账号**；ACS 缓存 AK 来自缓存所属账号，两者可能不同。
2026-10-21 用户指定的本地 ACR AK 已验证可管理目标实例，补建了独立、公开且 tag 不可变的
候选仓库，这是首次接入的历史状态；当前按用户要求统一到 `cloud-runtime-cn`，
版本与源码双标签不可变。旧候选仓库不再接收新版本，也不改写旧标签。AK 已写入 candidate Environment Secret；只允许
`feat/cloud-settings-native-client` 分支。本机完成临时 Registry 登录、测试制品推送、
匿名读取和同标签覆盖拒绝，测试标签已清理；GitHub 候选发布也已通过。现有 AK 的 RAM 身份管理查询
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
CLI 由 [install_aliyun_cli.py](install_aliyun_cli.py) 按固定 SHA-256 校验后安装到 job 临时
目录，不使用 sudo、不修改系统目录；candidate 在完整构建前验工具，cache 也使用同一入口。
CLI 3.5.0 的 API 路径在加载 AK 环境变量前校验 profile；脚本因此在系统/runner 临时目录
创建 0700 目录和 0600 vendor profile，换取 token 后立即清除，不读写默认 `~/.aliyun`。
AK 不进入命令参数、源码、日志或 artifact；Docker 只通过 stdin 接收临时密码，
只写当前 job 的 `DOCKER_CONFIG`，由 workflow 的 always 清理步骤删除登录配置。
两种鉴权方式不会因失败自动切换；错误仅输出固定错误码，CLI 响应正文不外泄。
ACS 的 [AK 调用](acs-api.mjs) 同样使用临时 vendor profile，并剥离子进程环境中的其他
阿里云凭据，避免环境覆盖所选身份；每次调用成功或失败后都清理。
AK 由 cache Environment 注入，与 ACR 账号和 Secret 完全独立。
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

这是运行池资格验收，不是 GitHub 交付、OAuth 或 DeviceLink 验收。后续新候选的
完整源码构建、隔离 smoke 和候选发布已在 GitHub job 通过。GitHub 出站诊断见下文；
完整源码交付另见本页顶部运行；ACR 发布鉴权、Actions 触发和 ACS AK 创建/清理已接通。
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

后续对用户提供的三个内网 SNI 转发地址做了独立 ECI 测试：其中两个地址的 GitHub
首页、API、raw、codeload 均返回 200，三个地址都完整下载了同一 Actions 压缩包并通过
归档解析和 SHA-256 比对；第三个地址的 GitHub 首页返回 403，未选用。24 次 HTTPS
握手全部保留证书校验。GHCR 未登录返回 401、Actions 控制端点根路径返回 404，分别
只证明服务可达。三个地址的 UDP DNS 查询均超时，它们是域名 A 记录的目标，不能当作
nameserver。

[专属 runner 镜像](runner/Dockerfile) 使用官方精确 digest 加 Python 3.12 和编译工具。
可选 [DNS sidecar](runner/dns-sidecar.py) 仅在该作业 Pod 的回环地址提供解析：将 GitHub
相关域名指向 operator 配置的 SNI 转发地址，其他域名交给配置的 DNS 上游；匹配域名的
AAAA 查询不回落到公共地址。真实地址只在部署配置中，源码不写内部 IP；不修改共享
`CustomDNSConfig`，不关闭 TLS 校验，不注入个人代理凭据。启动、正常退出、取消与
超时都必须回收 sidecar 和临时卷，详见 [runner 说明](runner/README.md)。

依赖安装曾在 `nodejs.org` 下载 Node 22 头文件时超时。随后独立 ECI 探针通过同一
SNI 转发地址完整下载该 9.9 MB 文件并计算 SHA-256；Docker Hub 鉴权端点、Chrome 下载
域名和 Debian 快照站也通过 TLS 可达检查。需要下载 Node 头文件的 check Pod 显式将
`nodejs.org` 加入 `SNI_FORWARD_DOMAINS`，不能只配置 GitHub。这些连接检查不替代
镜像层与完整安装包下载验收。

完整交付仍须从 runner 进程及 BuildKit 内分别验证实际下载；Pod 中简单 HTTPS 请求
成功不能替代注册、领任务或构建网络验收。

按 [GitHub 官方出站域名清单](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#requirements-for-communication-with-github)
覆盖注册/领任务、Actions 下载和 artifact 传输。根路径返回经过 TLS 验证的 404 仅证明
该端点可达；不能替代 runner 注册、真实 job 或 artifact 上传。

三个 job 分别调度 `self-hosted, Linux, X64` 加以下标签：

| job | 专属标签 | 权限 |
| --- | --- | --- |
| verify | `cindy-fork-cloud-check` | 无云发布凭据、无 Docker 特权 |
| candidate | `cindy-fork-cloud-build` | 独立 DinD；最后发布步骤读取 candidate Environment |
| cache | `cindy-fork-cloud-cache` | 无 Docker 特权；cache Environment 的 AK 与缓存权限 |

runner **只注册到 fork 仓库 `https://github.com/zhuoshaojian/cindy`**，不注册组织或企业，
不借用主仓、企业或已有 GitLab Runner。标签本身不是授权边界；核对注册 URL、仓库归属、
短期注册/JIT token 和每个实例的单次 job 生命周期。创建 token/runner 的凭据不交给构建
进程，runner 不挂业务凭据。只接收指定 fork 分支的 push/dispatch；本工作流不监听 PR，
不把外部 PR 自动送入该 VPC 运行池。持续自动供给使用 [队列控制器](runner/README.md#自动供给控制器)，
在独立 namespace 按需创建与回收；不使用长期在线、共享数据的执行机器。

准备完成后核对 runner 架构、Docker daemon 架构和磁盘；再打开交付开关，让本次受信任
运行完成完整构建、原生 smoke、推送和缓存 Ready。记录 workflow URL、recipe commit、
双版本号、image config ID、Registry digest 和各主/init 缓存结果。环境配置成功不能代替
首次真实交付；缓存 Ready 不能代替 Pod 命中或完整产品验收。

依据：[GitHub runner 隔离与 JIT](https://docs.github.com/en/actions/reference/security/secure-use)、
[ACR 权限资源](https://www.alibabacloud.com/help/en/acr/user-guide/ram-authorization-information)、
[ACR 标签不可变](https://www.alibabacloud.com/help/en/acr/user-guide/turn-on-immutable-image-version)、
[ACS 创建缓存](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-createimagecache)、
[ACS 查询列表](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-listimagecaches)、
[ACS 查询详情](https://www.alibabacloud.com/help/en/cs/api-acc-2024-04-02-getimagecache)、
[ACS 删除缓存](https://help.aliyun.com/zh/cs/api-acc-2024-04-02-deleteimagecache)。
