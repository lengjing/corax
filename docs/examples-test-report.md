# Examples 实测报告

## 范围与方法

- 测试日期：2026-10-23；Windows x64，Bun 1.4.2。
- 四个 `general` 子 agent 分组覆盖 `examples/` 下的 14 个示例，使用统一的 `examples/.env`，没有使用 gpt-worker 执行测试。
- 使用独立临时项目、数据库、构建缓存和随机监听端口；不复制 `.env`，不在报告中保存凭证。
- 动态验证使用真实模型、HTTP/SSE、SQLite 和 Bun 运行时；工具、技能与委派通过 `action.result`、`task.settled` 等实际事件核验，不以模型口述作为成功依据。
- Vitest 的 Node worker 仅用于补充源码回归，不能代替 Bun 的真实运行验证。

## 逐示例覆盖

所有示例均通过发现检查，错误和告警为零；动态验证如下。

| 示例 | 已验证 | 边界 |
| --- | --- | --- |
| minimal | 真实模型单轮、默认会话渠道、生产编译 | 未启动生产 HTTP 服务 |
| tools | `get_time` 正常调用、非法时区产生 RangeError、同会话后续调用恢复、生产编译 | 未做高并发压力测试 |
| skills | 两种技能实际加载，返回正文与发现结果全文一致、生产编译 | 示例没有附带可执行脚本，未测技能脚本运行 |
| hooks | 实际 audit 日志；额外注入 observer 异常后当前轮及后续轮仍完成、生产编译 | 未注入永不结束的异步 hook |
| channels | dev/prod 健康、正确/错误 Basic、未认证 session 401、两轮真实上下文 | 未覆盖所有渠道类型 |
| memory | agent 实际保存；同 principal 新会话及新进程重启读回；跨 principal 隔离；缺 principal 禁用 | 读取由上下文自动召回，模型仍可能误调用写入/删除工具；未测并发写冲突 |
| sandbox | 实际 bash、`>/dev/null`、读写文件/管道、同会话文件保留、运行中取消 | 未测试 Docker、Microsandbox 或硬件访问 |
| subagents | researcher 真实委派、子会话事件、最终汇总、真实子模型 400 向父任务传递 | 联网研究被本机 fake-IP DNS 阻断，不算成功获取来源 |
| connections | Petstore 19 个 operation schema；真实模型只读 GET；MCP 未配置禁用；本地 HTTP MCP fixture discovery/list/call | 未配置外部 MCP，未测远端认证/旧协议兼容 |
| extensions | git 动态指令及 `git__pr` skill；真实模型加载 skill；无 broker 时 `git__gh` 不启用 | 未执行 GitHub 写操作、签名 commit 或 PR 发布 |
| schedules | TS/Markdown 注册；HTTP 触发两种 handler；未知 ID 404；真实 Bun production cron 在受控时钟下自动触发 heartbeat | Markdown 日报验证到模型开始执行，未验证最终摘要；原例未包含动态 SQLite collection |
| instrumentation | 真实模型回合生成根/step/model span，shutdown 后 CLI traces list/show 可读且关联正确 | 并发持久化错误已修复并独立重测；不等于证明所有压力场景无数据丢失 |
| evals | 列举、真实 greeting、hello gate、JSON 报告、成功 exit 0、无效 ID exit 2、故意失败断言 exit 1 | 未做大规模评测或外部 judge 评测 |
| basic | 同会话组合工具/技能/子 agent；完整生产构建；production health 与鉴权正反例 | 真实组合模型回合在 dev；production 模型由 channels 示例另行验证 |

## 已确认并修复的问题

### 原子写文件的临时名碰撞

`shared/atomic-write-file.ts` 使用 target、PID、毫秒时间组成临时路径；同进程同毫秒写同一文件时发生竞争。

- 真实 instrumentation 和 basic 委派中观察到 `local trace persistence failed / rename ENOENT`。
- 原独立复现：12 个并发 writer，2 成功、10 个 ENOENT。
- 修复：随机 UUID 临时名；写入或替换失败均清理本次 writer 的临时文件。
- 独立回归：12 成功、0 失败；真实 instrumentation 回合无上述持久化错误，关闭后三个主要 span 完整。
- 永久回归：`tests/atomic-write.test.mjs`，同时检查最终文件完整及无临时文件残留。

### SQLite 一次性调度忽略时区

delay 被归一化为无偏移时间及 `timezone: UTC`，provider 却直接 `Date.parse()`，错误地使用宿主时区。

- Asia/Shanghai：5 分钟延迟任务创建即 completed；UTC：正常；America/New_York：额外延迟 4 小时。
- 修复：无偏移 wall-clock 使用既有 cron 库及声明的 IANA 时区；默认 UTC；显式 ISO 偏移保留毫秒精度。SQLite 与 in-memory provider 共用解析规则。
- 独立回归：三个宿主 TZ 的 delay 都 active，nextAt 与预期完全一致；扩展时区矩阵 21/21 通过。
- 深入回归另发现 DST 回拨期间 cron 库可能返回已过去的时间，从而重复投递；已增加严格未来时间检查。
- 最终使用原 DST 复现脚本，在 UTC、Asia/Shanghai、America/New_York 三个宿主 TZ 均只投递一次，SQLite 与 in-memory 状态均为 completed。
- 永久回归：`shared/schedule-time.test.ts`、`tests/schedule-timezones.test.mjs`，覆盖 UTC/上海/纽约、声明时区、ISO 毫秒、DST gap/fold、到期投递与 completed 状态、延迟轮询不重复投递。

### 示例说明与实际能力不一致

- git 扩展裸挂载实际提供指令和 PR skill，`git__gh` 需要 GitHub broker；已更正示例注释与说明。
- 框架默认注入 corax 会话渠道，未声明 `channels/` 并不等于不能交互；已更正文档。
- `byPrincipal` 缺 principal 时禁用 memory slot，并非返回结构化 scope 错误；已补充说明。

## 仍需跟踪的观察

以下项目没有作为本轮已修复问题处理：

1. 启动偶见 `Local schedule polling failed; retrying.`，关闭时偶见 workflow queue drain/取消竞态日志。业务成功且监听已关闭，但 catch 未保留 cause，尚不能确认具体根因或是否影响恢复。
2. DeepSeek 出现 AI SDK `unsupported feature: tool type: provider` 告警，普通函数工具通过；原生 provider 工具兼容性仍需专门检查。
3. 模型 400 故障路径的日志会深度打印请求消息、工具 schema 和响应元数据；未发现实际 API key 被打印，但日志最小化与脱敏仍需处理。
4. 联网 web_fetch 被本机 `198.18.x.x` fake-IP 保留地址策略拒绝。未修改代理设置或放宽目的地址检查。
5. 追踪修复回归首轮曾遇到证书校验错误，保留失败证据后重试一次成功；未关闭 TLS 校验。
6. 空 memory 的“读取”提示可能被模型误解为 save/remove 操作。跨 principal 隔离已验证，但自然语言要求只读不构成代码层面的只读保证。

## 回归命令

最终结果：`bun run typecheck` 通过，`bun run test` 为 32/32；下述源码定向回归为 30 通过、1 个既有 Windows 条件跳过。

```sh
bun run typecheck
bun run test
```

源码定向回归（从 `packages/corax` 运行）：

```sh
bun x vitest run src/shared/atomic-write-file.test.ts src/shared/atomic-write-file.integration.test.ts src/shared/schedule-time.test.ts src/runtime/schedules/validation.test.ts
```

完整执行证据与重放脚本保存在测试机器的 `C:\Users\lengjing\AppData\Local\Temp\opencode\` 下：

- `example-tests-model/REPORT.md`
- `example-tests-state/group-cms/REPORT.md`
- `example-tests-connections/REPORT.md`、`RECHECK.md`
- `example-tests-combined/REPORT.md`、`RECHECK.md`

这些临时证据未纳入仓库。所有测试自行创建的服务均已关闭；报告保留未测边界，不把“编译成功”或“保留能力文件”视为对应功能已经端到端验证。
