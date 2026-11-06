# 发布到 npm

## 发布内容

`packages/corax/package.json` 的版本是公开 SDK 与 CLI 的唯一发布版本。
公开 npm 包名为 `@coraxjs/core`，CLI 命令仍叫 `corax`。本地 tarball 路径保持 `artifacts/corax.tgz`，发布身份由包内 manifest 决定。
`npm run pack` 先构建，再将可分发文件组装成 `artifacts/corax.tgz`：

- 包含 `bin/`、`dist/`、`.d.ts`、README、LICENSE 和 NOTICE。
- 将 `corax-source` 等条件中的源码路径改为已构建路径。
- 不包含源码、开发依赖、生命周期脚本、用户项目、凭据或预安装的 `node_modules`。
- 源码 workspace 仍为 private，避免绕过组装步骤误发布；临时包 manifest 为可公开发布的 `@coraxjs/core`。

## 首次发布

需要拥有 npm 组织 `coraxjs` 下 `@coraxjs/core` 的发布权限，并满足 npm 的发布认证要求（2FA 或具有 Bypass 2FA 权限的 granular token）。首次创建包时，在可信本机登录 npm 并执行：

```sh
npm install
npm test
npm run typecheck
npm run pack
npm run test:package
npm publish ./artifacts/corax.tgz --access public
```

需要预览时执行 `npm publish ./artifacts/corax.tgz --dry-run`，不会上传。

## GitHub Actions Trusted Publishing

首次发布后，在 npm 的 `@coraxjs/core` 包设置中添加 Trusted Publisher：

- Provider：GitHub Actions
- Owner / Repository：`lengjing` / `corax`
- Workflow filename：`release.yml`
- Environment：`npm`

在 GitHub 仓库中创建名为 `npm` 的 Environment，按团队需要设置发布审批。认证使用 OIDC，workflow 已配置 `id-token: write` 和 provenance，无需保存长期 npm token。若仓库转移或 workflow 改名，需要同步更新 npm 的 Trusted Publisher 设置。

## 日常版本发布

```sh
npm version 0.1.1 --workspace packages/corax --no-git-tag-version
# 检查并提交 manifest 以及对应变更说明；package-lock.json 不提交
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

推送 `v*` tag 后，`.github/workflows/release.yml` 会：

1. 运行 Linux / Windows 构建、类型、测试和包安装验证。
2. 校验 tag 与包版本完全一致。
3. 在发布 job 中重新构建、打包并验证该 tarball。
4. 将同一个 tarball 发布到 npm，并附带 provenance。
5. 保存 tarball 为 GitHub Actions artifact。

正式版本使用 `latest` dist-tag，含 `-` 的预发布版本（如 `0.2.0-beta.1`）使用 `next`。npm 版本不可覆盖；发布失败后先核对 registry 是否已有该版本，再决定重试或提升版本。

`npm run release` 只发布已有 `artifacts/corax.tgz`，不会偷偷重建。自动发布流程负责在发布前构建和验证。
