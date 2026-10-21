# fork 交付环境接入

本页是 [交付流水线](README.md) 的首次配置手册；配置完成和真实运行通过是两件事。
镜像仍只交付 candidate，不修改 CIS、实例、新认领默认或稳定版本。

## GitHub 启用与 Environment

仓库：`zhuoshaojian/cindy`；可信分支：`feat/cloud-settings-native-client`。

先查看仓库 Actions 页面是否提示 fork 的工作流被暂停。`actions/permissions` 返回
`enabled: true` 不能排除 GitHub 另行暂停 fork；2026-10-21 实际出现过
“Workflows are not currently being run on this fork due to the scale of GitHub Actions usage”。
此时由仓库维护者在页面重新启用，不能将无 run 记录当作检查通过，也不用改默认分支来规避。

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

按 ACR 的账户配置流程设置该身份的 Registry 登录密码，直接写入 candidate Environment 的
`CLOUD_IMAGE_REGISTRY_USER`、`CLOUD_IMAGE_REGISTRY_PASSWORD`。这两个值是 Registry 登录
凭据，不是 RAM AccessKey。不要上传个人已有的全局 Docker 凭据，不授予仓库删除、改设置、
生产部署或其它仓库的推送权限。如果采用 API 获取临时 Registry token，需另行接入
`cr:GetAuthorizationToken` 并补实测；当前 workflow 使用专用 Registry 密码。

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
2026-10-21 已在目标 ACK 的独立临时命名空间实测：Pod 调度到 ECI 虚拟节点，架构为
`x86_64`，`privileged: true` 生效，临时 tmpfs 挂载、写入、卸载通过，退出码为 0；
Job 与命名空间已清理。这仅证明该环境的特权容器能力，不代表 DinD、Buildx、Cindy smoke
或 GitHub 交付已通过。

- GitHub runner 管理组件与 ECI 作业使用独立 namespace、ServiceAccount 和凭据；沿用
  现有 ECI 调度方式，不修改现有 GitLab Runner，也不复用其注册或缓存身份。
- ECI 作业 Pod 使用 `alibabacloud.com/eci: "true"` 标签；工作目录和 Docker 数据目录
  使用本次作业的临时卷。按实测峰值配置临时存储，不挂宿主 Docker socket 或业务 PVC。
- 当前 workflow 需要 Docker daemon，采用 DinD 时只向其构建容器授予所需特权。
  runner 使用共享 Unix socket 或受保护连接访问 daemon，不对外暴露 Docker API。
  完整验收须仍验证镜像中的 UID 10001、无 capabilities 和 seccomp，不能放宽应用沙箱。
- 接入前实际运行 Docker/Buildx、完整 Dockerfile 和 `smoke.py`，确认嵌套运行及清理可用。
  通过后才将该运行池用于真实候选交付，不能以 Runner 显示 online 替代这些检查。

标签为 `self-hosted, Linux, X64, cindy-cloud-build`。标签本身不是授权边界；公开 fork 的外部
PR 都应要求维护者批准，且交付环境只允许上述分支。若需要持续自动供给 runner，应在隔离的
运行池配置按需创建与回收，不以一台长期在线、与业务网络互通的机器代替。

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
