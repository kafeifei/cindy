# 云实例实时任务活动

存量 `instance-runtime/status.ts` 的 `activity-unknown` 是未接线的占位值，
不是任务探测结果。此云打包覆盖层复用原有重启阻断探针，并补充输入队列和调度器：

- 逻辑 turn、Claude 后台活动、插件后台活动、后台 Bash、Cindy slot 在途工作、Pi 子任务；
- 排队输入、压缩、等待交互、派发/终态收口和调度自动续跑；
- scheduler 内存中的执行/排队、持久化 running 记录、未来两分钟到期任务；
- 正在执行的远程调用和账号/数据库 owner 切换。

所有来源缺失、异常、类型错误、超时或 owner 变化都保留 `activity-unknown`，并给出
具体 blocker。异步读取前后复采内存来源；最多一个在途异步扫描，读取超时后不会
堆积查询。至少两次采样且经过 10 秒安静观察窗口后才报告 idle。状态仍每 5 秒原子
发布，停止后的迟到扫描不能把 stopping 覆盖为 ready。不记录会话 ID、正文或凭证。

这份清单是已接入的任务活动来源，不是对进程内所有异步维护工作的穷尽声明。
新增任务执行器需要补来源与对应 busy/unknown 测试。该读数不是 drain 锁，也不能
授权按旧快照直接重启实例；执行前仍须检查实时状态和生命周期栅栏。

保留现有 v1 状态字段和就绪/身份/OAuth 语义。新增 `cloudActivity` 是观察字段，
现有 CIS parser 按原规则剥离。`idle.blockers` 使用现有开放字符串数组，不改变协议。
`maySuspend` 继续为 false，不顺带启用自动停机。此目录没有重启、实例镜像切换或
发布默认镜像的功能。

仅在云镜像 main 入口显式加入 `cloudTaskActivityPlugin({sourceRoot})`，不安装到
preload 或 renderer。所有转换在内存发生，不回写普通客户端源码，也不改变 IPC
权限、远程 allowlist、Platform 或部署策略。接线缺失、重复或漂移会使构建失败。

```sh
CINDY_ACTIVITY_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-activity/*.test.mjs
```

旧运行实例不会因为新覆盖层已写好就立即获得这些内存探针。首次生效必须使用包含
覆盖层的新云镜像；在禁止重启运行实例的范围内，只能等待其正常停止后安排切换。
禁止热改正在使用的 asar、注入调试器、冒用同事登录态或把持久化记录为 0 伪装成
完整的实时空闲证明。源码/离线测试通过不代表存量实例已生效。
