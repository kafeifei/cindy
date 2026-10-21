# fork 专属一次性 runner

仅用于 `zhuoshaojian/cindy` 的 `feat/cloud-settings-native-client` 交付。
镜像由[官方 runner 的固定 amd64 digest](Dockerfile)构建；允许使用 manifest 一致的公开镜像搬运副本。
这是 CI 工具镜像，不是 Cindy 云运行时基座。

- 注册使用 GitHub **仓库级** `POST /repos/zhuoshaojian/cindy/actions/runners/generate-jitconfig`；
  名称每次唯一，仅分配当前 job 的 `cindy-fork-cloud-check`、`cindy-fork-cloud-build` 或
  `cindy-fork-cloud-cache` 标签，不注册组织或企业。
- JIT 配置通过短期 Kubernetes Secret 只读挂载到 `/run/cindy-jit/config`。控制端的 GitHub
  PAT 不进入 Pod，JIT 值不放在命令参数或日志中；官方 listener 消费并清除
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

不把这里的一次性启动等同于常驻弹性控制器。首次交付通过后，可由专用控制组件按队列
供给相同模板；创建 token 的凭据与 job 身份仍必须隔离。
