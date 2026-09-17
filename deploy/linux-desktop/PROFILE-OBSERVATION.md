# 运行健康观测

镜像将本目录的 `profile-supervisor.mjs` 放到
`/usr/local/lib/cindy/profile-supervisor.mjs`，并同批更新由
`apps/desktop/src/main/instance-runtime/profile-runtime-wire.ts` 构建的 wire bundle。
只更新 ASAR 不会替换镜像继承的 supervisor。

运行观测接受最多 64 个 CDP SystemInfo 发现的 renderer，逐一测量 /proc 的 PID、启动时间、
Seccomp/filter 数、NoNewPrivs 与 capabilities；不得截取前几个进程。独立的 preflight
仍最多 8 个，保证 Kubernetes 4 KiB termination receipt 有界。运行证据保留 16 KiB、
私有文件权限、身份/代际和心跳检查；超过容量或任何进程测量失败都撤下证据。

失败会输出固定 `PROFILE_OBSERVATION_UNAVAILABLE` 事件和 stage/code，不包含 telemetry、
原始异常、URL 或凭据；同一连续故障去重。启动和停止期间证据不可用仍属正常生命周期。

先部署兼容 64 renderer 的 CIS 读取端，再更新对应 runtime。旧运行证据仍被新 CIS 接受；
旧 CIS 会拒绝超过 8 个 renderer 的新证据。不可只以基本 status.ready 代替完整安全观测。
单元测试的 CDP /proc 替身只能证明边界；发布后还需真实多 renderer、当前凭据续期和
CIS 实際读取验证。
