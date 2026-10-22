# fork 专属一次性 runner

仅用于 `zhuoshaojian/cindy` 的 `feat/cloud-settings-native-client` 交付。
镜像由[官方 runner 的固定 amd64 digest](Dockerfile)构建；允许使用 manifest 一致的公开镜像搬运副本。
这是 CI 工具镜像，不是 Cindy 云运行时基座。

- 注册使用 GitHub **仓库级** `POST /repos/zhuoshaojian/cindy/actions/runners/generate-jitconfig`；
  名称每次唯一，仅分配当前 job 的 `cindy-fork-cloud-check`、`cindy-fork-cloud-build` 或
  `cindy-fork-cloud-cache` 标签，不注册组织或企业。
- JIT 配置通过短期 Kubernetes Secret 只读挂载到 `/run/cindy-jit/config`。控制端的 GitHub
  PAT 不进入作业 Pod，JIT 值不放在命令参数或日志中；官方 listener 消费并清除
  `ACTIONS_RUNNER_INPUT_JITCONFIG` 后才启动 job。确认 listener 启动后删除 Secret。
- 每个 Pod 只运行一个 job。工作目录、HOME 写入层和 `/ci` 都是本次作业的临时空间，
  不挂业务 PVC、宿主 socket 或 ServiceAccount token。runner 以 UID/GID 1001 运行，
  drop ALL capabilities、`allowPrivilegeEscalation: false`；创建 `/ci` 时确保 1001 可写。
- [入口](entrypoint.py)转发取消信号，并在退出后写 `/ci/runner.done`。DNS/DinD sidecar
  读取该标记退出；Job 设置 `activeDeadlineSeconds`、`backoffLimit: 0` 和完成后 TTL。
  控制端仍需在启动失败或超时时清除未注销的仓库 runner 和 JIT Secret。
- 只有 build Pod 配置独立 privileged DinD；check/cache 不配置 Docker socket 或特权容器。
  使用经典 `overlay2`，具体参数及原生启动验收见 [接入手册](../BOOTSTRAP.md)。

可选 [dns-sidecar.py](dns-sidecar.py) 使用成熟 dnsmasq 做 Pod 内分域解析。只开放该 Pod
回环地址 53 端口，无 Service 或 hostPort。build Pod 可额外传入 Downward API 的
`POD_IP`，只监听本 Pod 地址以供嵌套 DinD 访问；DinD 默认 DNS 同时指向该地址。sidecar 以 UID 0、drop ALL 再添加
`NET_BIND_SERVICE`、`SETGID` 运行，不授予 privileged；dnsmasq 会清除附加组，
即使目标组仍是 root 也需要 `SETGID`。runner 本身继续 drop ALL。`GITHUB_SNI_FORWARD_IP` 为已验证的转发目标，
`DNS_UPSTREAMS` 为逗号分隔的实际 DNS 服务器。`SNI_FORWARD_DOMAINS` 可显式增加已验证的
镜像仓库等域名，默认仅包含 GitHub 域名，不设置 HTTP/HTTPS 代理变量。Pod 自定义 nameserver 指向 `127.0.0.1`。
其他域名仍走 DNS 上游，GitHub TLS 仍由客户端端到端验证；这不是 HTTP 代理或集群 DNS
配置。构建容器网络需独立检查，不能假定嵌套 Docker 自动继承 Pod DNS。

## 自动供给控制器

[controller.py](controller.py) 每 30 秒读取该 fork 的 `cloud-image-delivery.yml` 队列。
只接受上述分支的 push / workflow_dispatch，以及 verify、candidate、cache 三个明确 job；
仓库、来源仓库、分支、workflow 路径、commit 与标签都要匹配。每个 job 额外要求
`cindy-fork-run-<run_id>-<run_attempt>` 标签，避免别的运行抢占它的 runner。
不会触发、取消或重跑 workflow，不接受 PR，也不访问组织/企业 runner API。

- 小型控制进程在 ACK 的独立 `cindy-fork-runners` namespace 常驻；执行 job 仍是临时 ECI。
  无入站 Service/webhook，只需出站访问 GitHub。单副本 Recreate + Kubernetes Lease
  防止控制器滚动或故障期间双写；每次外部写操作前续租并校验持有者。
- [provision.py](provision.py) 复用已验收的 ECI 模板：check 4 CPU/16 GiB、build 8 CPU/32 GiB、
  cache 1 CPU/2 GiB（均含 sidecar）；磁盘仅 emptyDir。真实镜像与网络由部署配置传入，
  镜像必须锁定 digest。只有 build 的 DinD 提权，控制器和所有 runner 都无特权。
- 一次性 runner 启用 ECI ImageCache 自动匹配，并要求所有工具镜像精确匹配；
  不固定易过期的缓存 ID。使用 ECI 自动生成的缓存；手工 ImageCache 会把根盘与
  emptyDir 分到不同磁盘，不能用于本 DinD 模板。预热对象只有固定 digest 的 runner/DinD 镜像，
  不包含作业目录、JIT、发布凭据或 DinD 构建数据。工具缓存与云实例 ACS 缓存独立。
  未命中时仍可正常拉取，不能将启用注解等同于实际命中；按 Pod 注解和拉取事件记录耗时。
  DinD 启动前核对实际 `/var/lib/docker` 至少有 80 GiB 空闲空间，不足时在领取 job 前失败；
  Pod 声明的 150 GiB 扩容注解不能代替实际挂载检查。
  注解契约见 [ECI ImageCache 文档](https://help.aliyun.com/en/eci/user-guide/use-imagecache-to-accelerate-the-creation-of-pods-2)。
- Kubernetes ConfigMap 保存每个 GitHub job 的状态与 runner ID，**不存凭据**。注册/JIT/创建 Job
  中途崩溃后可续接；丢失的 JIT 先注销旧身份，启动失败最多尝试 3 次。执行中的 job 不另起替身。
  最多 3 个未完成 job，超过限额保留在 GitHub 队列。超过限额或身份不匹配会记录固定错误码。
- 只有尚未执行的注册允许自动补供给。已经观察到执行或 Kubernetes Job 成功退出后，
  即使 GitHub 读取暂时退回 `queued`、Job 已被清理，也不为同一个 job ID 再建 runner；
  等 GitHub 的终态回收。用户主动 rerun 生成的新 job ID 仍可正常申请。
- JIT 在 GitHub 显示 job 已开始后删除。正常完成等待 listener/DinD 退出；取消或未退出时最多
  等待 120 秒再清理。删除校验管理标签及 UID，不碰非本控制器资源；先确认 Job/Pod 回收再注销 runner。
  每个 Job 有独立最大时长与 TTL；控制器暂时不可用时，ECI 也会被 deadline 停止。
- 完成回执保留 7 天，再由控制器删除。GitHub job 日志/artifact 继续按 workflow 保留。
  失联时不推断任务完成、不因 API 查询失败删除运行中的作业；下一轮重试。注册凭据失效须轮换 Secret。

### 部署与维护

复制 [controller.example.json](controller.example.json) 到仓库外私有配置，填入已经验收的
runner/DinD digest、SNI 目标与 DNS 上游。不要将真实网络配置提交到仓库。

控制器凭据单独放在 `cindy-fork-autosupply-github` Secret 的 `token` 键；建议使用只授权
`zhuoshaojian/cindy` 的 fine-grained PAT，权限为 **Actions: read、Administration: write**。
已有管理凭据可以由 operator 明确选用，但不能宣称它因此变成了最小权限 token。
控制器只调用仓库级 API；令牌仅挂载到控制容器，不进入 runner、DNS/DinD、Git、日志或 artifact。
ACR/ACS 发布 AK 仍只由各自 GitHub Environment 注入各自 job，不交给控制器。

```sh
# 操作前确保当前 kubectl context 是目标 ACK；不要使用业务命名空间。
# 从仓库外受保护文件读取 token，不将值放在命令参数中。
kubectl -n cindy-fork-runners create secret generic cindy-fork-autosupply-github \
  --from-file=token=/private/path/github-token
python3 deploy/linux-desktop/delivery/runner/render.py --config /private/path/controller.json \
  > /private/path/controller-manifest.json
kubectl apply -f /private/path/controller-manifest.json
kubectl -n cindy-fork-runners rollout status deployment/cindy-fork-autosupply
```

[render.py](render.py) 输出源码/配置哈希命名的 immutable ConfigMap、Deployment、ServiceAccount
和**仅该 namespace**的 Role/RoleBinding。SA 只准管理 Job、JIT Secret、状态 ConfigMap 与 Lease；
不授予实例、PVC、集群级或其它命名空间权限。SA token 显式只挂给 controller，DNS sidecar 不挂。
部署源码变动后重新渲染/apply，旧 Lease 最多等待 180 秒即可接管；不会丢失已启动 job。

暂停新供给可将 Deployment 缩为 0；已有 ECI 按自身时限退出，恢复控制器后补清理。
故障时查看 controller 的 `controller_cycle_failed` / `reconcile_failed` 固定错误码及
`cfr-state-*` 回执；不要输出 Secret。修复根因后若 3 次启动已用尽，在 GitHub 取消仍排队的运行后重跑（已失败则直接重跑），
新 job ID 会获得新身份，不修改旧回执或重用旧 JIT。

生产入口回归见 [test_autosupply.py](../test_autosupply.py)：重复轮询、重启续接、失落 JIT、
取消回收、重试上限、Lease 排他和凭据隔离；纯内存单测，单文件约 0.1 秒。
官方契约：[仓库级 JIT](https://docs.github.com/en/rest/actions/self-hosted-runners#create-configuration-for-a-just-in-time-runner-for-a-repository)、
[workflow job 查询](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run)。

2026-10-22 已部署并通过真实 push 交付及回收验证，见 [验收记录](../ACCEPTANCE-AUTOSUPPLY-20261022.md)。
