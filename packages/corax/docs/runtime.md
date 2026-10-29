# 运行约定

## 项目与模块

CLI 和 git、npm 一样从当前目录向上查找 agent 项目，不需要额外的位置参数。定义、指令、渠道、memory 和 sandbox 在同一级；其他能力沿用核心支持的目录约定。

项目通过普通 TypeScript import 组合模块。CLI 不生成文件、不自动安装依赖。

## 环境与路径

- 使用 Bun 运行，环境文件由 Bun 在启动时加载和展开变量，进程已有的变量始终优先。请从项目目录启动，或用 `bun --env-file=<路径>` 显式选择环境文件；项目发现不会额外加载父目录环境。
- 修改环境文件后重启 `corax dev`。CLI 检测到项目 env 文件变化时提示重启，不会推断变量来源或覆盖启动环境；使用 `--env-file` 的外部文件也需手动重启。
- `PORT`：默认监听端口（dev 2000，start 3000）；`--host` / `--port` 命令行选项优先。
- `.corax/`：本地工作流、会话状态，以及默认的 SQLite memory 与动态调度数据库（可用各自的 `path` 选项改到别处）。
- `.output/`：用户 agent 的生产构建产物。

不要把这些运行数据放入 CLI 安装目录。

## 模型路由

`model` 应传入 AI SDK provider 实例，例如 `createOpenAI({ baseURL }).chat("gpt-4.1-mini")`，并提供 `modelContextWindowTokens`。请求只发往该 provider 配置的地址。

裸字符串模型 ID（如 `"openai/gpt-4.1-mini"`）在 AI SDK 中默认经由 Vercel AI Gateway 路由。Corax 不会隐式启用该网关：未选择时，编译与运行阶段都会报错并给出修改建议，也不会向 `ai-gateway.vercel.sh` 获取模型目录或探测 Vercel OIDC 凭据。需要使用 Gateway 时显式开启：

- `CORAX_MODEL_CONNECTION=ai-gateway-key` 并提供 `AI_GATEWAY_API_KEY`；
- 或自行设置 `globalThis.AI_SDK_DEFAULT_PROVIDER`，让裸字符串解析到你自己的 provider。

缺少 `modelContextWindowTokens` 时，仅在已开启 Gateway 的情况下才会查询其模型目录；否则必须显式提供。

## 认证与交互

channels 示例提供 HTTP Basic 与本地开发认证。生产环境需设置 `CORAX_USERNAME` / `CORAX_PASSWORD` 才能使用其受保护会话入口。健康接口 `/corax/v1/health` 公开。

memory 的 `byPrincipal` 作用域依赖渠道提供认证主体。只添加 memory 并不会自动创建渠道；可复制 channels 示例进行组合。

## 持久化

memory 与动态调度使用 Bun 原生 `bun:sqlite`。数据库连接关闭时显式释放 prepared statements，避免 Windows 下文件句柄滞留。

动态调度采用事务、租约、稳定 executionId 与重试，实现至少一次投递。失败和重启恢复不等于外部副作用恰好一次；调用外部系统时应自行使用 executionId 幂等。

SQLite 调度每次有界处理最多 16 项，到期积压未清空时继续轮询。失败通知持久化并独立重试最多 10 次；崩溃窗口可能再次通知，接收方同样按 executionId 去重。通知重试耗尽后记录保留供检查，不会无限自动重发。

## 构建与关闭

核心构建、用户源码编译和生产服务均由 Bun 执行。编译器依然使用工作流转换、vendoring 和 Nitro 的构建插件；它们是构建依赖，不需要 Node 进程回退。

CLI 复用现有终端/API 接入与关闭机制。`start` 只运行已有产物。JustBash 使用虚拟文件系统，不自动提供本机任意命令执行。
