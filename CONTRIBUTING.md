# 开发约定

## 环境

使用 Node.js 24+ 和 npm 11+：

```sh
npm install
npm run build
npm run typecheck
npm test
```

依赖变更使用 npm，提交相应 package.json。`package-lock.json` 按仓库约定忽略，不提交；CI 使用无锁文件安装，新 checkout 按 manifest 中的版本范围解析依赖。不要提交 `.env`、密钥、运行数据、构建产物或 `node_modules`。

## 测试分层

延续 eve 的源码旁测试与 `.integration.test.ts` / `.scenario.test.ts` 命名约定：

| 层级 | 位置 / 命令 | 边界 |
| --- | --- | --- |
| 单元 | `packages/*/src/**/*.test.ts`；`npm run test:unit` | 排除 integration/scenario；核心包的 guard 禁止真实网络、写盘和子进程，依赖显式 mock |
| 自包含集成 | 核心包 `vitest.integration.config.ts` 及 tracing 集成测试；`npm run test:integration` | 环境加载、模型配置、日志、trace 和本地文件，不需要模型密钥 |
| 产品回归 | `tests/*.test.mjs`；`npm run test:regression` | Node Test Runner；验证构建后的 CLI、SQLite、项目定位、远程连接等 |
| npm 包 | `tests/package/*.test.mjs`；`npm run test:package` | 安装真实 tarball，在仓库外检查类型、构建、认证和服务启动，需要 npm registry 网络 |

后三类及源码单元测试需要先构建核心。`npm test` 自动构建；单独运行某层时先执行 `npm run build`。

源码中还保留 eve 的 Workflow test-world、Docker 等场景测试。这些依赖外部基础设施或尚未迁移的上游 fixture，**不属于当前默认测试或 CI 覆盖**。不能把 `src/**/*.test.ts` 不加区分地全部运行，也不要把场景失败改成无条件跳过来掩盖问题。新增自包含集成测试应加入 `vitest.integration.config.ts`。

优先测试可观察行为和边界：认证、持久化、并发、重试、环境优先级与产物可安装性。使用临时目录并清理，文件路径用 `node:path`，时间用可控时钟。不要为了测试通过恢复已删除的托管平台功能；删除废弃接口测试时保留其他有效断言。

测试不能依赖开发者的模型凭据。核心单元测试为字符串模型夹具显式设置 Gateway 选择，但清空密钥并禁止真实网络；集成测试默认关闭 Gateway，需要时由具体用例显式启用。验证 CI 差异时应同时隔离环境变量，而不只是创建干净的源码副本。

长负载循环不应混入日常回归；用能触及批次边界、重复投递和时间推进的最小样本覆盖行为。

## 改动与提交

一次提交聚焦一项可解释的变更，避免把功能、格式化、依赖升级和文档大改混在一起。推荐消息格式：

```text
fix(cli): restore remote connection command
fix(env): restore transactional dotenv reload
test(runtime): cover SQLite lease recovery
ci(release): publish verified npm tarballs
docs: document npm installation
```

破坏性变更使用 `!` 或 `BREAKING CHANGE:`，正文说明原因、迁移方式和验证。提交前检查 diff，只暂存本次改动。仓库不安装提交钩子，也不强制提交格式。

## 发布

唯一公开 npm 包是 `corax`。内部包和示例保持 private。构建及打包不要并行操作同一个 `dist/`；发布时使用已通过安装测试的 tarball，详见 [发布指南](docs/releasing.md)。
