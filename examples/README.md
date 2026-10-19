# Agent 示例

每个子目录都是扁平 agent 项目：`agent.ts` 与能力模块同级，不需要额外的 `agent/` 目录。示例之间不互相导入，可分别运行或复制模块组合。

| 目录 | 内容 |
| --- | --- |
| `minimal/` | 只有模型与根 agent 定义 |
| `channels/` | 根定义 + `channels/corax.ts`，展示终端/API 渠道认证 |
| `memory/` | 根定义 + `memory/personal.ts`，展示按用户隔离的 SQLite 记忆 |
| `sandbox/` | 根定义 + `sandbox.ts`，展示 JustBash 沙箱 |
| `basic-agent/` | 指令、渠道、memory 和 sandbox 的完整组合 |

在仓库根目录执行 `bun install` 和 `bun run build` 后，将所选示例的 `.env.example` 复制为同目录 `.env` 并填写模型配置。例如：

```sh
bun --no-env-file cli/bin/corax.ts dev --root examples/channels
bun --no-env-file cli/bin/corax.ts build --root examples/memory
```

`memory` 和 `sandbox` 刻意不附带渠道。要通过终端/API 交互，可将 `channels/channels/corax.ts` 复制到目标项目的 `channels/corax.ts`；按用户隔离的 memory 需要渠道提供认证主体。完整交互也可以直接运行 `basic-agent`。

组合模块后同步声明它们需要的依赖，例如 JustBash 沙箱需要 `just-bash`。复制到仓库外时，需将 `workspace:*`、`catalog:` 改为实际的包版本或本地 tarball 路径，再执行 `bun install`。
