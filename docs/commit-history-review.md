# Git 提交历史审查

审查基线：`a049c04`；共 12 个 commit。日期：2026-10-26。

## 修复进展（当前工作区，尚未提交）

下文逐提交结论和复现描述保留的是审查基线状态，不代表修复后的状态。基线发现的 9 项运行时/API 缺陷、1 项测试断言缺陷以及此前的 2 项 env 缺陷，现均已处理：

| 问题 | 修复 |
| --- | --- |
| 默认镜像 tag 随 Corax 版本变化 | 独立固定上游 `0.79.1`，保留显式 image/tag 覆盖 |
| SQLite 每秒最多投递一项 | 每轮有界 drain 16 项，仍有到期工作时立即续轮；两小时模拟 12,000 次投递无积压 |
| 耗尽租约漏发失败通知 | 使用持久化通知表，独立租约、退避及最多 10 次通知尝试；成功后不再重发，耗尽记录保留。崩溃窗口是至少一次语义，消费者按 executionId 去重 |
| 自定义默认 provider 被 Gateway 替换 | 自定义 provider 优先于开发 Gateway transport |
| 自定义 provider 误放行 Gateway catalog | 拆开裸 ID 解析许可与 Gateway 网络许可；自定义 provider 本身不授权访问 catalog |
| 失效的 setup exports | 删除 `corax/setup` 和 `corax/setup/scaffold` 导出声明 |
| 已删除命令的修复提示 | setup/error/status-line 改为真实环境/provider 配置指引；self-modification 不再承诺自动弹出 setup panel |
| single 接受 cron 字符串 | 进入时区解析前验证日期形式，拒绝 cron |
| 无偏移小数秒丢失 | 保留最多三位毫秒，更高精度明确拒绝；带偏移 ISO 保留既有解析语义 |
| Git URL 测试错误 | 断言与 repo=corax 的输入对齐 |
| env 归属推断及插值失配 | Bun 原生启动加载；env 编辑要求进程重启，不再覆盖启动环境 |

TUI 同步修复了依赖旧生产命令注册表的过时断言，保留 generic 补全测试的自定义 fixture，并退役纯 remote-auth badge 测试。整份 terminal-renderer 测试 172/172 通过；最终合并回归为 16 个文件、339 项定向测试通过，产品测试 39/39、类型检查通过。

验证边界：镜像 tag 可用性依据审查时 registry manifest 检查，本轮未拉取/启动容器；Gateway 验证为拦截网络的离线断言；调度负载为真实 SQLite 配合受控时钟，并非实时 Nitro 压测。其它此前仅观察到但未确证的启停日志和 provider compatibility warning，不因此宣称全部解决。

后续复查修正了两处边界：env 文件变化只在重建路径要求重启，既有凭据请求继续使用启动环境；失败通知退避从回调完成时计算，不让慢回调消耗退避。新增真实凭据接口及受控时钟回归后，产品测试为 41/41、类型检查通过，env/重建/凭据定向测试为 25/25。

## 覆盖与限制

本轮把全部 12 个提交纳入审查，而不是只看提交标题。三个 general 子 agent 分别检查初始 fork、平台删除/Gateway、最近八个提交；主会话复核证据、对每个历史版本执行隔离的锁文件一致性检查，并修复此前确认的 env 问题。

- 初始导入以本地 eve 仓库 `eve@0.79.1` 的 Git 对象为基线，做全 tree/blob 比对，归一化品牌标识符，避免把 `never` 等普通单词替换掉。
- 初始 fork 的 143 个非测试残余 diff、61 个测试残余 diff、23 个非搬迁新增文件以及 42 个包外编排文件已阅读；2742 个归一化相同文件和 58 个等价搬迁文件仅做自动比对。1045 个上游未保留路径已枚举分类，未逐行审阅它们的旧内容。
- `f810745` 的 179 个非整文件删除 diff 已完整阅读；504 个整文件删除纳入引用检查，其中只额外展开 3 个旧实现。没有把阅读删除清单声称为阅读所有被删代码。
- 其余提交的实际 diff 已逐项审阅；纯语法修正通过 before/after blob 等价检查。
- 没有对每个历史版本进行完整构建、全量测试、发布或所有外部集成验证。当前工作区的产品测试不代表所有历史版本通过。

## 逐提交状态

锁文件列是在临时目录提取该版本全部 package.json、bun.lock、bunfig.toml 后执行 `bun install --frozen-lockfile --lockfile-only --ignore-scripts` 的结果；不执行安装脚本，不等于完整应用安装/构建验收。

| Commit | 修改审阅 | 锁文件 | 结论 |
| --- | --- | --- | --- |
| `3964559` | 按上述上游归一化差异覆盖 | 通过 | 默认容器镜像、SQLite 队列/失败回调问题仍存在；另有 Git URL 测试断言错误 |
| `bb01cb4` | 全部 11 文件 diff | 通过 | 自定义默认 provider 的运行时路由及 catalog 门禁存在遗漏 |
| `f810745` | 全部 179 个非整文件删除 diff；504 个删除路径引用检查 | 通过 | 两个公开 setup exports 悬空；通用测试覆盖随平台删除损失 |
| `33ee714` | 全部 19 文件、741 行 diff | 通过 | 两个旧 launcher 参数错误，已随 `71694a3` 删除而消失 |
| `1f31ab4` | 81 文件逐 blob 验证，107 处仅冠词替换 | 通过 | 未发现额外语义修改 |
| `cba37cd` | 8 文件 100% rename | **失败** | 未同步引用及锁文件；拆分不完整 |
| `a059460` | 全部 9 文件 diff，Bun 定向探针 | **失败** | env 来源推断错误；继承上一提交的锁文件问题 |
| `71694a3` | 全部 52 文件 diff | **失败** | 修正重命名引用，但锁文件仍旧；残留失效 TUI 命令提示 |
| `c01956f` | 全部 11 文件 diff | **失败** | 示例配置彼此一致；仍继承旧锁文件 |
| `fb5fb6f` | 全部 71 文件 diff | 通过 | 更新锁文件，根 evals 分类及子 agent 告警回归有效 |
| `afda67e` | 全部 2 文件 diff，12 路并发探针 | 通过 | 原子替换修复有效；不是 read-modify-write 锁 |
| `a049c04` | 全部 7 文件 diff，时区/DST 探针 | 通过 | 正常路径修复有效；直接 provider 输入仍有两个边界缺陷 |

## 基线发现与复现记录（修复见上表）

### P2：默认 Docker/Microsandbox 镜像 tag 不存在

引入：`3964559`。`execution/sandbox/bindings/corax-image.ts:4–14` 把 Corax 包版本 `0.1.0` 用作上游 `ghcr.io/vercel/eve` 的 tag。只读 registry 检查中 `0.1.0` 为 404，`0.79.1` 为 200。未实际启动容器。需固定经过验证的上游镜像版本/摘要，或维护自己的镜像发布链。

### P2：SQLite 调度持续积压

引入：`3964559`。`public/schedules/providers/sqlite.ts:336–356` 每轮只 claim 一个 occurrence，runtime plugin 等投递完成后再休眠一秒。100 个合法的每分钟任务，用真实 SQLite 和受控时间模拟 180 次轮询，产生 300 项，完成 180 项、积压 120 项。需有界批量 drain 或有界并发，并为积压调度下一轮。

### P2：最终租约耗尽漏发失败回调

引入：`3964559`。`sqlite.ts:348–356` 直接将第十次 claim 后崩溃、租约过期的记录标 failed；该记录不进入后面的 jobs 循环，因此 `onFailure` 未调用。真实数据库状态注入结果为 failedRows=1、failedCallbacks=0。需要将终结项纳入通知路径，必要时持久化通知状态。

### P2：自定义默认 provider 在 dev 中被 Gateway 替换

涉及：`bb01cb4`。`runtime/agent/resolve-model.ts:82–89` 仍优先调用 `localGatewayModel`；当开发 broker 可用时，即使用户只配置了 `AI_SDK_DEFAULT_PROVIDER`，得到的也是 `gateway` 模型对象。该优先级旧实现早已存在，但新增“自定义默认 provider 可用”的契约没有覆盖这条路径。离线源码 probe 已确认，未发送模型请求。

### P2：自定义默认 provider 错误放行 Vercel catalog 请求

引入：`bb01cb4`。`shared/model-helper.ts:15–21` 将“允许裸 ID 通过自定义 provider 解析”与“允许 Gateway 网络请求”合为同一判断；`compiler/model-catalog.ts:217–225` 使用此判断访问固定的 Vercel catalog。离线拦截确认仅配置自定义 provider 即会尝试访问该 URL。应拆分两种权限判断。

### P2：TUI 推荐已删除的 `/login`、`/model`

引入：`71694a3`。`cli/dev/tui/setup-issues.ts:143–148`、`errors.ts:123–129` 仍推荐旧命令，但解析器返回 null，runner 随后把输入发给模型，而不会修复配置。应改为现有的 env/provider 配置指引，并联测提示与命令解析。self-modification 的终端 setup handoff 文案也有残留，尚未实际触发外部安装验证。

### P2：single 调度可以被错误输入变成循环任务

引入：`a049c04`。`shared/schedule-time.ts:20–25` 将任意无偏移字符串交给同时接受 cron 的解析器。直接调用 `sqliteScheduleProvider().create()` 并传 `{type:'single',at:'* * * * *'}`，两次轮询实测投递两次且状态仍 active；旧实现会拒绝。高层 ScheduleClient 有格式校验，不能把此问题扩大为所有高层输入都可触发。provider 边界应确保 single 是日期而非 cron。

### P3：single 无偏移小数秒丢失

引入：`a049c04`。直接 provider 使用 `2030-01-01T12:00:00.123`、timezone UTC，当前时间同秒 `.050Z` 时返回 null，实际尚余 73ms。带 Z 的分支保留精度，无偏移分支被 Croner 截为秒。需保留精度或显式拒绝，不能静默提前完成。高层 minute-only validator 不接受该输入。

### P3：公开 setup exports 指向已删除模块

引入：`f810745`。`packages/corax/package.json:488–498` 仍公开 `corax/setup`、`corax/setup/scaffold`，源码却已删除。历史 tree 映射及当前模块解析均确认悬空。应删除残留 exports，而不是恢复有意移除的功能。

### P2 测试缺陷：Git URL 参数与断言不一致

引入：`3964559`。`shared/git.test.ts:25–28` 及 `public/channels/github/checkout.test.ts:46–55,70–73` 传入 repo=`corax`，却期待 `vercel/eve.git`。真实 helper 正确返回 `vercel/corax.git`。这是错误测试，不是生产 URL 拼接 bug。

## 本轮已修的 env 问题（尚未提交）

`a059460` 以值相等猜测 env 来源：shell 值与文件值相同，或后来恰好匹配时，下一次文件编辑可覆盖 shell 值；Bun 展开的 `${VAR}` 又与 parseEnv 原文不同，导致值不刷新。两个问题均由隔离合成环境复现。

本轮改为明确的启动环境策略：

- Bun 原生负责环境文件加载、插值和启动优先级，不引入 `--no-env-file` 或 re-exec。
- CLI 不再重新应用 dotenv 值，检测到项目 env 文件修改时提示重启。
- 显式启动环境也优先于保存的 provider settings；provider settings 仍保留独立的 stage/rollback。
- 文档明确从项目目录启动，或使用 Bun `--env-file`；不承诺环境文件热重载。

回归包含真实 Bun 子进程：shell 与文件同值、不同值、变量插值，修改后当前进程保持不变且要求重启，重启后由 Bun 加载新值。`bun run test` 35/35、typecheck 通过；env 和 rebuild-coordinator 定向测试 14/14。

## 历史已修及审查边界

- 重命名脚本/测试引用在 `71694a3` 修正，锁文件在 `fb5fb6f` 修正。不改写历史；回退到中间版本仍需知道这些缺陷。
- 旧 `--root` 预扫描会吞掉其它参数的值；旧 CORAX_PORT 提前校验使显式 `--port` 不能覆盖错误默认值。这两条路径已删除。
- 上游 LICENSE 字节一致；NOTICE 前置 4 行 Corax 说明，其后保留上游 77 行。仅核对文件保留，不作法律结论。
- 平台移除时整体删除了部分混合通用/平台测试，例如 auth、client、channel dispatch、callback 和框架适配测试。属覆盖缺口，不等同于已确认运行时缺陷。
- 没有验证所有旧版本发布产物、所有 IANA 历史时区、真实 Docker/Microsandbox、全部第三方渠道/框架部署，或整份依赖锁文件的供应链安全。

详细复现脚本与逐文件覆盖清单在测试机器临时目录 `C:\Users\lengjing\AppData\Local\Temp\opencode\history-review-{initial,platform,recent}\`，以及 `history-lock-results.json`。没有读取真实 `.env`，没有重写提交历史，也没有将这些复现文件或凭证纳入仓库。
