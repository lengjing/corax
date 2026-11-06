# Corax

Corax 是基于 **Node.js + TypeScript** 的自托管 AI Agent 框架，同时提供 SDK 和终端 CLI。通过约定目录组合模型、指令、工具、渠道、记忆、沙箱、子 Agent 和定时任务，再由 Corax 发现、编译和运行。

基于 eve 0.79.1 修改，采用 Apache-2.0 许可证并保留上游版权声明。

## 安装与使用

运行需要 **Node.js 24+**。

```sh
npm install corax @ai-sdk/openai
```

一个最小项目：

```text
my-agent/
├─ agent.ts
├─ instructions.md
├─ .env
└─ package.json
```

```ts
// agent.ts
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "corax";

const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default defineAgent({
  model: provider.chat("gpt-5.4"),
  modelContextWindowTokens: 400_000,
});
```

在 `.env` 中设置模型密钥，在 `instructions.md` 中编写指令，然后运行：

```sh
npx corax dev
```

模型应传入 AI SDK Provider 实例并声明上下文窗口。裸字符串模型 ID 会使用 AI Gateway；仅在显式配置 `CORAX_MODEL_CONNECTION=ai-gateway-key` 和 `AI_GATEWAY_API_KEY` 时启用该路径。

## CLI

| 命令 | 用途 |
| --- | --- |
| `corax dev` | 开发服务、热重载和终端交互；`--no-ui` 仅启动服务 |
| `corax build` | 编译当前 Agent 到 `.output/` |
| `corax start` | 启动已有生产产物；不会自动重新构建 |
| `corax remote connect --url <url>` | 用终端 UI 连接已有服务 |
| `corax info` | 查看解析后的项目配置 |
| `corax logs` / `corax traces` | 查看开发日志和追踪 |
| `corax eval` | 运行 Agent 评测 |

CLI 从当前目录向上定位项目。开发默认监听 `127.0.0.1:2000`，生产默认监听 `0.0.0.0:3000`，可用 `--host` / `--port` 覆盖，端口也可通过 `PORT` 设置。健康接口为 `/corax/v1/health`。

```sh
npx corax build
npx corax start
# 在另一个交互式终端连接，不需要本地 Agent 项目：
npx corax remote connect --url http://localhost:3000
```

认证由项目的渠道模块配置。客户端可传入重复的 `--header "Authorization: Bearer <token>"`，或通过 `http://用户名:密码@localhost:3000` 提供 Basic Auth（特殊字符需 URL 编码）。非本地地址使用 HTTPS。

## 配置与持久化

- 环境文件优先级：进程已有变量 > `.env.development.local` > `.env.local` > `.env.development` > `.env`。
- 使用 Node dotenv 解析规则，`${VAR}` 保持字面值。开发模式重新加载文件管理的变量，支持更新、删除及重建失败回滚；启动时已有的进程变量不被覆盖。生产服务修改环境后需重启。
- 显式环境配置优先于交互式保存的 Provider 设置。
- `.corax/` 保存会话、工作流、日志、trace、沙箱缓存及默认 SQLite 数据库；`.output/` 保存生产构建产物。
- 宿主可设置 `CORAX_PROJECT_ROOT` 为项目绝对路径，设置 `CORAX_DATA_DIR` 为绝对路径或相对项目的数据目录。编译器隔离副本仍有独立的内部产物目录。
- 默认持久化使用 `node:sqlite`。动态调度采用至少一次投递，支持稳定 executionId、租约和重试。
- 认证后的 `GET /corax/v1/session?limit=50&offset=0` 返回根会话元数据 `{ sessions, hasMore }`。
- JustBash 是虚拟文件系统沙箱，不是本机原生 shell。

## 示例

[`examples/`](examples/README.md) 按能力拆分，可复制和组合：

| 示例 | 能力 |
| --- | --- |
| `minimal` / `channels` | 最小定义、会话 API 与认证 |
| `memory` / `sandbox` / `tools` | SQLite 记忆、JustBash、自定义工具 |
| `skills` / `connections` | 技能、OpenAPI 和 MCP |
| `subagents` / `schedules` | 子 Agent 和定时任务 |
| `hooks` / `extensions` | 生命周期钩子与 git 扩展 |
| `instrumentation` / `evals` | 本地追踪和评测 |
| `basic` | 完整组合 |

示例默认使用 DeepSeek。复制对应 `.env.example` 为 `.env` 并设置 `DEEPSEEK_API_KEY`，可用 `DEEPSEEK_BASE_URL`、`CORAX_MODEL` 和 `CORAX_CONTEXT_WINDOW` 覆盖默认配置。

## 仓库开发

需要 Node.js 24+ 和 npm 11+，无需 Bun。

```sh
npm install
npm run build
npm run dev --workspace examples/channels
```

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建 SDK、CLI 和 `.d.ts` |
| `npm run build:example` | 构建 basic 示例（核心构建不会自动更新示例产物） |
| `npm run typecheck` | 检查内部包及全部示例类型 |
| `npm test` | 构建后运行单元、集成与产品回归测试 |
| `npm run pack` | 生成可发布的 `artifacts/corax.tgz` |
| `npm run test:package` | 在仓库外安装并验证上一步生成的 npm 包 |

```text
packages/corax/          SDK、CLI、运行时及源码测试
packages/corax-catalog/  内部集成目录（随核心打包，不单独发布）
packages/tracing/        内部追踪库（随核心打包，不单独发布）
examples/               Agent 示例
tests/                  产品回归、包安装验证与辅助程序
scripts/                npm 包组装
.github/workflows/      Linux/Windows CI 与 npm 发布
```

贡献与测试约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，npm 首次发布、Trusted Publishing 和版本操作见 [发布指南](docs/releasing.md)。
