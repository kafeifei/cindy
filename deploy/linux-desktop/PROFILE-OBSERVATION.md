# 运行健康观测

镜像最终打包须遵守 [IMAGE-PACKAGING.md](IMAGE-PACKAGING.md)：保留运行依赖和安全
入口，压平历史层，每次发布只保留一份应用；瘦身后仍须通过本页的运行验收。

镜像将本目录的 `profile-supervisor.mjs` 放到
`/usr/local/lib/cindy/profile-supervisor.mjs`，并同批更新由
`apps/desktop/src/main/instance-runtime/profile-runtime-wire.ts` 构建的 wire bundle。
只更新 ASAR 不会替换镜像继承的 supervisor。

云运行、维护和预检入口显式设置 `disable-dev-shm-usage`；supervisor 也给候选与
旧兼容恢复应用传入该参数。Chromium 共享图像使用既有临时卷中的私有、已取消目录链接的
文件，避免多个软件渲染窗口耗尽容器默认的 64 MiB `/dev/shm` 后退出。普通 Desktop
不受影响；不增加内存配额、不改变 Keyring/PVC、不改变 seccomp、NNP 或能力集。
临时卷磁盘仍可能耗尽，应按实际临时存储容量监测；此参数不宣称解决所有内存不足。
发布验收须包含原安全上下文中的菜单反复开关、共享内存压力和完整运行观测。

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
