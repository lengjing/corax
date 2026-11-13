# 0.1.x：官方 SQLite Local World 接入

## 基线与依赖来源

维护分支从 `470108ab6772bed840f30fe6a8043c130ac85923` 建立，保留当前 Corax v26
公开契约和 Workflow core 5.2.0。该提交是 0.1.0 发布时的 origin/main；时间、包名与依赖
均匹配 registry 的 0.1.0，registry 未提供 gitHead。Corax 补丁包版本为 0.1.1。

本地 World 使用官方 [Workflow #5235](https://github.com/vercel/workflow/pull/5235) 的固定提交：

```text
vercel/workflow@c11fc40013681fef9afe0b315b1d22284579bbe0
```

该提交于 2026-11-12 合并。npm world-local 5.3.0 发布于 11 月 10 日，实际仍是旧文件实现，
所以本轮没有把同名 npm 版本当作 SQLite 修复。

`vendor/workflow-world-local/` 保存官方源码、LICENSE、原 manifest 和逐文件 SHA-256。
私有本地 manifest 将上游 workspace/catalog 依赖固定到可安装版本；Corax 的 npm workspace
通过 file 依赖使用这些构建输入。构建验证 commit 和文件内容，再由原有 vendoring 管线编译。
普通构建不下载源码；显式刷新命令为：

```sh
node scripts/refresh-workflow-world-local.mjs
```

刷新使用 gh 获取固定提交树，下载后校验 Git blob，保留上游源码不变。Corax 适配放在外部：
版本 fallback 注入、公开类型 shim、dev RPC 转发边界及恢复时的 orphaned-step 释放。
发布包包含编译后的 JS、声明、LICENSE 和 UPSTREAM.json，不包含 vendor 源码或开发 file 依赖。

## 存储及读取行为

- World 自己使用 `<dataDir>/world.db` 和 Node 内置 SQLite；没有应用另建的会话数据库。
- 尾信息是 stream_chunks 主键的末行查询；区间读取按索引取行，不逐个打开 chunk 文件。
- 不再使用旧文件存储的目录缓存、EOF 标记缓存或 32 路扫描转换。
- 保留有限 HTTP 请求内的固定尾边界，防止响应头与正文采用不同的并发追加边界。
- 正游标实时读取不再额外查尾；使用 run metadata 检查保留未知/过期会话的拒绝行为。
- Core 仍运行 spec 8；没有借这次存储接入整体迁移 eve v27、动态定义或沙箱契约。

按用户要求，以新数据验证，不实现旧历史迁移。官方实现不读取旧文件布局；本轮不删除开发者文件。

## 验证入口

```sh
npm run build:core
npm run typecheck
npm run test:unit --workspace packages/corax
npm run test:integration
npm run test:regression
npm run benchmark:history
npm run pack
npm run test:package
```

针对性验证：

- 本地 World：只读不创建数据库、写入 world.db、不生成 streams 目录、重开后尾/分页读取、
  EOF 后写入拒收、负游标及取消、tag 清理和持久化。
- 来源：正常 checksum 校验通过，篡改源码字节会拒绝构建。
- 原生会话：本地假 OpenAI 服务；生产及 dev 各完成一轮，退出整个服务进程，再重启继续第二轮。
  新旧两轮均出现在同一会话中；不调用真实模型或设备。
- tarball：仓库外安装、SDK 类型、真实 build、生产/dev 启动、未知会话 HTTP 404、
  SQLite 产物、跨模块副本请求作用域与有限响应头/正文一致性。

## 长流测量

独立 seed 进程写入 20,000 个 350 字节 chunk 并关闭；另一个全新进程首次读取：

| 项目 | 结果 |
| --- | ---: |
| 逻辑 payload | 7,000,000 字节 |
| world.db 大小 | 10,059,776 字节 |
| 新进程首次尾查询 | 3.92 ms |
| 尾部 512 chunk | 1.74 ms |
| 完整读取 | 179.05 ms |

这测的是原生存储，不是完整桌面渲染，也不是受控冷磁盘实验。它消除了先前真实文件样本中
首次查询必须打开 9,000 多个文件的路径，不用 UI 缓存命中代替底层验证。

## 应用接入

当前 Auto-Agent 通过本地 link 使用本分支。正式接入发布包后，应移除针对 core 0.1.0 的
patchedDependencies，并将旧 helper 路径检查改为新产物/存储行为检查。不要将旧补丁叠到新包上。

## 发布前验证结果

- 核心全量单元：7,650 通过，28 跳过。删除的是不再存在的旧 filesystem read helper 专用测试。
- 集成：核心 60 通过、1 跳过；tracing 34 通过。
- 产品回归：49 通过，包含生产和 dev 各自的跨进程续聊及上游源码校验。
- 全部 workspace/示例类型检查、构建和 tarball 外部安装测试通过。
- Auto-Agent 的根、后端、桌面解析均指向本地 0.1.1，实际数据目录已生成 WAL 模式的 world.db；
  用户已确认新会话的历史切换明显变快。
