# Agent 示例

每个子目录都是扁平 agent 项目：`agent.ts` 与能力模块同级，不需要额外的 `agent/` 目录。示例之间不互相导入，可分别运行或复制模块组合。

| 目录 | 内容 |
| --- | --- |
| `minimal/` | 只有模型与根 agent 定义 |
| `channels/` | `channels/corax.ts`：终端/API 渠道与 HTTP Basic / 本地开发认证 |
| `memory/` | `memory/personal.ts`：按用户隔离的 SQLite 记忆 |
| `sandbox/` | `sandbox.ts`：JustBash 虚拟文件系统沙箱 |
| `tools/` | `tools/get_time.ts` + `lib/time.ts`：文件名即工具名，`lib/` 放共享代码 |
| `skills/` | `skills/code-review/SKILL.md`（带 frontmatter 的打包技能）与 `skills/concise-answers.md`（单文件技能） |
| `connections/` | `connections/petstore.ts`（OpenAPI 规范自动生成工具）与 `connections/mcp.ts`（`defineDynamic`，仅在配置 `MCP_SERVER_URL` 时启用） |
| `schedules/` | `schedules/morning-digest.md`（frontmatter 写 cron，正文作为提示词）与 `schedules/heartbeat.ts`（`run` 处理器） |
| `subagents/` | `subagents/researcher/`：目录名即子 agent id，`description` 决定何时被委派 |
| `hooks/` | `hooks/audit.ts`：观察 `turn.completed`、`action.result` 等事件 |
| `extensions/` | `extensions/git.ts`：挂载内置 git 指令与 `git__pr` skill；`git__gh` 工具需要额外配置 GitHub broker |
| `instrumentation/` | `instrumentation/traces.ts`：`localTraces()` 写入本地 OpenTelemetry 追踪，`corax traces` 可查看 |
| `evals/` | `evals/evals.config.ts` + `evals/greeting.eval.ts`：`corax eval --list` / `corax eval` 运行 |
| `basic/` | 以上全部能力的完整组合 |

所有示例默认通过 OpenAI 兼容接口使用 DeepSeek 的 `deepseek-flash` 模型。在仓库根目录执行 `bun install` 和 `bun run build` 后，将所选示例的 `.env.example` 复制为同目录 `.env` 并填写 `DEEPSEEK_API_KEY`。可通过 `DEEPSEEK_BASE_URL` 和 `CORAX_MODEL` 覆盖接口地址与模型。例如：

```sh
bun run --cwd examples/channels dev
bun run --cwd examples/memory build
bun run --cwd examples/evals eval -- --list
```

框架默认提供 corax 会话渠道，未显式声明 `channels/` 的示例也能在开发模式通过终端/API 交互。`channels`、`evals` 和 `basic` 展示显式渠道配置：`evals` 使用本地开发认证，`channels` 和 `basic` 还展示生产 HTTP Basic 认证。按用户隔离的 memory 依赖渠道提供认证主体；缺少 principal 时该 memory slot 被禁用。记忆通过上下文自动召回，save/remove 工具用于写入和删除，不是读取接口。完整组合可直接运行 `basic`。

组合模块后同步声明它们需要的依赖，例如 JustBash 沙箱需要 `just-bash`，`zod` 工具参数需要 `zod`。复制到仓库外时，需将 `workspace:*`、`catalog:` 改为实际的包版本或本地 tarball 路径，再执行 `bun install`。

`connections` 和 `basic` 的 Petstore 连接会在加载工具时访问公开的 OpenAPI 规范；MCP 连接仅在填写 `MCP_SERVER_URL` 时启用。`schedules` 和 `basic` 启动后会注册 cron 任务，其中晨间摘要会调用模型。评测的 `--list` 只列出用例；实际运行评测需要模型凭证与可用的渠道。
