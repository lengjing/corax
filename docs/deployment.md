# Bun CLI 部署

## 从源码运行

```sh
bun install --frozen-lockfile
bun run build
bun --no-env-file cli/bin/corax.ts dev --root examples/channels
```

需要 Bun 1.4.2+。模型配置位于目标项目的 `.env`，实际调用模型需要可用凭证。

## 发布包

```sh
bun run release
```

输出 `release/corax-<版本>-<系统>-<架构>.tgz`。压缩包包含 CLI、编译后的核心 SDK 和生产依赖，解压后不需要构建 corax 本身。使用匹配系统和架构的包。

```sh
bun --no-env-file /path/to/corax/cli/bin/corax.ts --help
bun --no-env-file /path/to/corax/cli/bin/corax.ts dev --root /path/to/my-agent
```

可在解压目录执行 `bun link`，在 Bun 的全局 bin 目录已加入 PATH 时使用 `corax`。入口 shebang 会禁用自动加载启动目录环境文件。

### 用户项目依赖

全局安装 CLI 不会自动让用户项目获得 `corax/*` 和模型 SDK。当前源码核心为私有包，发布包同时附带 `packages/corax.tgz`，用户可在自己的 package.json 中指定本地 SDK：

```json
{
  "name": "my-agent",
  "private": true,
  "type": "module",
  "dependencies": {
    "corax": "file:/absolute/path/to/corax/packages/corax.tgz",
    "@ai-sdk/openai": "^4.0.91"
  }
}
```

然后在用户项目执行 `bun install`。Windows 可使用正斜杠形式的绝对路径。沙箱等能力按需增加对应依赖。仓库内示例的 `workspace:*` 和 `catalog:` 仅用于本仓库，复制到外部项目后需替换。

## 构建用户服务

```sh
corax build --root ./my-agent
corax start --root ./my-agent
```

构建输出为 Bun 服务，`start` 使用 Bun 启动。构建 CLI 与构建用户 agent 是两个独立步骤。

升级时保留项目 `.corax/`、`data/` 和 `.env`。本地 World 面向单机、单服务部署；不承诺跨版本滚动迁移。调度外部副作用应使用 executionId 做幂等。
