# Corax

基于 Bun 的本地 agent CLI 运行器。通过约定目录中的 TypeScript 模块自由组合模型、指令、渠道、memory 和 sandbox，再由 corax 发现、编译和运行。CLI 不生成项目，也不绑定一个固定 agent。

## 环境与安装

需要 **Bun 1.4.2+**；创建发布压缩包还需要 `tar`。

在仓库根目录执行：

```sh
bun install --frozen-lockfile
bun run build
```

也可执行 `bun run setup` 完成安装和构建。依赖安装、工程脚本、测试和服务运行均使用 Bun。

## Agent 项目约定

项目根目录就是 agent 根目录，无需额外的 `agent/`：

```text
my-agent/
├─ agent.ts
├─ instructions.md
├─ channels/
│  └─ corax.ts
├─ memory/
│  └─ personal.ts
├─ sandbox.ts
├─ .env
└─ package.json
```

`agent.ts` 定义模型等根配置，其余能力按需添加。项目通过自己的 `package.json` 声明 `corax`、模型 SDK 和可选沙箱等依赖。

## 运行

源码 checkout 中使用：

```sh
bun --no-env-file cli/bin/corax.ts dev --root examples/channels
bun --no-env-file cli/bin/corax.ts dev --root examples/basic-agent --no-ui
bun --no-env-file cli/bin/corax.ts build --root examples/basic-agent
bun --no-env-file cli/bin/corax.ts start --root examples/basic-agent
```

安装发布包的命令入口后使用：

```sh
corax dev --root ./my-agent
corax build --root ./my-agent
corax start --root ./my-agent
```

`--root` 默认当前目录。`dev` 启动服务和终端交互，`--no-ui` 只运行服务；`build` 生成生产产物，`start` 运行已有产物。默认监听 `127.0.0.1:2000`，健康接口为 `/corax/v1/health`。

使用 `--no-env-file` 防止 Bun 自动读取启动目录的环境文件；CLI 显式加载目标项目环境。已存在的进程环境变量优先。

## 按能力拆分的示例

| 示例 | 内容 |
| --- | --- |
| [`minimal`](examples/minimal/) | 只有模型与根定义 |
| [`channels`](examples/channels/) | 只增加终端/API 渠道和认证 |
| [`memory`](examples/memory/) | 只增加按用户隔离的 SQLite memory |
| [`sandbox`](examples/sandbox/) | 只增加 JustBash sandbox |
| [`basic-agent`](examples/basic-agent/) | 指令、渠道、memory、sandbox 完整组合 |

将所选示例的 `.env.example` 复制为同目录 `.env`，填写模型配置。示例之间不互相依赖，可以复制能力模块进行组合。memory 与 sandbox 示例不额外附带渠道；交互使用时加入 channels 示例中的渠道定义。详见 [示例说明](examples/README.md)。

## 示例配置

这些模型和认证变量由示例模块使用，不限制用户自定义模块的配置方式：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 空 | OpenAI 兼容模型服务密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 模型接口地址 |
| `CORAX_MODEL` | `gpt-4.1-mini` | 模型 ID |
| `CORAX_CONTEXT_WINDOW` | `128000` | 模型上下文 token 数 |
| `CORAX_USERNAME` | `admin` | 示例 HTTP Basic 用户名 |
| `CORAX_PASSWORD` | 空 | 示例生产会话 API 密码 |

CLI 使用 `CORAX_HOST`、`CORAX_PORT` 配置默认监听地址和端口，显式命令行选项优先；`CORAX_DATA_DIR` 配置数据目录，相对路径以目标项目为基准。

## 目录结构

```text
cli/                    通用 CLI 入口与项目接线
packages/corax/src/       核心框架与内置能力
packages/corax/scripts/   核心编译、vendoring、打包
packages/corax-catalog/   集成目录库
packages/tracing/       追踪库
examples/               按能力拆分的扁平 agent 项目
scripts/release.mjs      发布包组装与验证
tests/                  CLI、持久化及发布回归
docs/                   架构、运行和部署说明
```

CLI 命令与 SDK 包名均为 `corax`，公共 API 通过 `corax/*` 导入。仓库根包 `corax-workspace` 仅用于开发编排，发布压缩包中的 `corax-cli` 负责安装命令入口和本地 SDK。SDK 保留内部 bootstrap 导出，由 CLI 调用，不单独注册同名命令。

Corax 基于 eve 0.79.1 修改，保留上游许可证与版权声明。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `bun run build` | 构建 CLI 所需核心与运行资产 |
| `bun run build:example` | 构建 basic-agent 示例 |
| `bun run typecheck` | 检查核心、内部依赖、CLI 和示例类型 |
| `bun run typecheck:packages` | 仅检查 packages 中的 workspace 包 |
| `bun run typecheck:cli` | 仅检查 CLI 类型 |
| `bun run typecheck:examples` | 仅检查全部示例类型 |
| `bun run test` | 构建核心后使用 Bun Test 运行产品回归 |
| `bun run release` | 构建并验证可独立运行的 CLI 发布包 |
| `bun run test:release` | 验证已生成的 CLI 发布包 |

## 持久化与部署

每个项目的 `.corax/` 保存工作流和会话状态，`data/` 默认保存 SQLite memory 和动态调度数据库；`.output/` 保存生产产物。配置与数据写入目标项目，不写入 CLI 安装目录。

默认本地持久化使用 `bun:sqlite`。动态调度保留稳定 executionId、租约与重试，提供至少一次投递。示例使用本地 Workflow World 和 JustBash，不要求托管平台账号。JustBash 是虚拟文件系统沙箱，不等同于本机原生 shell。

发布包包含通用 CLI、核心 SDK 和运行依赖，不包含固定 agent 或本机密钥。用户项目仍需安装自己声明的依赖。详见 [部署说明](docs/deployment.md)、[运行说明](docs/runtime.md) 和 [架构说明](docs/architecture.md)。
