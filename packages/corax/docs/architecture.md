# corax 架构

## 产品边界

corax 是 Bun 原生的本地 agent CLI 运行器：用户提供模块，CLI 负责发现、校验、编译、组装与运行。不生成项目，不内置固定业务 agent。

## 仓库结构

```text
packages/corax/           核心发现、编译、执行、CLI 及服务宿主
packages/corax-catalog/   内部集成目录库
packages/tracing/       内部追踪库
examples/minimal/      最小根定义
examples/channels/     根定义加渠道
examples/memory/       根定义加 memory
examples/sandbox/      根定义加 sandbox
examples/basic/        完整组合
scripts/release.mjs     发布包组装与验证
tests/                 Bun Test 产品回归
docs/                  产品文档
```

## 运行链路

```text
packages/corax/bin/corax.js
    → 校验 Bun 版本、按需构建
    → dist/src/cli/run.js
      → 命令解析
      → 从当前目录向上发现 agent 项目
      → 模块发现与编译
      → 终端/API 服务或生产构建
```

项目根即 agent 根，agent.ts 与 channels/、memory/、sandbox.ts 同级。沿用框架已有 flat 发现能力，不复制临时 agent/ 目录。

CLI 不重复实现命令解析或执行引擎。packages 内部暂不重组，只调整 Bun 运行、SQLite、生产 preset 等必要兼容点。

## Bun 全链路

- 包管理：根 package.json workspace/catalog、bun.lock。
- 脚本与 CLI：Bun 直接运行 ESM 和 TypeScript。
- 测试：Bun Test；产品测试资源清理由 tests/support/test.mjs 管理。
- SQLite：bun:sqlite，显式关闭 outstanding statements。
- 生产服务：Nitro bun preset。
- 发布：Bun 安装生产依赖，生成通用运行器压缩包。
- 类型检查：Bun 执行 TypeScript 编译器，保留独立静态检查。

安装、构建和类型检查命令直接定义在根 package.json 中。类型检查分别覆盖 packages workspace 和全部示例；scripts/ 仅保留包含实际打包与验证逻辑的 release.mjs。

使用 Bun 支持的 node:* 标准兼容 API，不意味着保留 Node 可执行程序依赖。第三方编译器及框架插件继续由 Bun 执行，不是以 Bun 包管理、Node 运行的混合模式。

## 安装目录与项目目录

CLI 安装目录包含程序和 SDK；用户项目目录包含配置、定义、依赖、产物和状态。全局 CLI 依赖不能替代项目依赖声明。

发布包包含本地 SDK，用户项目可以通过 file: 依赖安装。SDK 的源码条件导出在打包时映射到已编译产物，避免发布后引用 checkout 源文件。

## 验证边界

迁移验证包括核心构建和类型检查、Bun Test 持久化回归、多个扁平示例发现、外部项目与发布包运行。当前交付为 Bun CLI，跨平台发布包需在对应系统上构建并验证。
