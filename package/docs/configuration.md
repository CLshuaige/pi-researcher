# 运行配置

配置按内置默认值 → Pi agent 目录的 `research.json`（通常 `~/.pi/agent/research.json`）→ 项目 `.pi/research.json` 合并。全部可选；项目同名字段覆盖全局字段，数组整体替换，`[]` 可关闭继承的扩展或工具。全局相对扩展路径基于 agent 目录，项目相对路径基于项目根目录。错误字段、缺少扩展、不可用的显式工具会报错。

```json
{
  "maxConcurrent": 2,
  "timeoutMs": 900000,
  "maxTurns": 30,
  "childExtensions": [],
  "extraTools": [],
  "reviewerTools": [],
  "enableMcp": false
}
```

| 字段 | 含义 |
|---|---|
| `maxConcurrent` | 同一 Research runtime、同一项目的活动子任务上限，1–8。跨 Pi 进程不共享该计数。 |
| `timeoutMs` | 单次委派的总超时，包括实验 engine 的内部工作；1 秒至 24 小时。 |
| `maxTurns` | 子会话模型请求上限，1–1000；压缩请求也计入。engine 内部有单独请求上限，但受外层总时间约束。 |
| `childExtensions` | 显式加载的本地扩展路径；相对路径按配置层解析，不自动加载所有用户扩展。 |
| `extraTools` | 普通子任务额外工具的精确名称；通配符和通用委派工具不接受。 |
| `reviewerTools` | 纯 `research-review` 子任务额外工具；默认无 Bash、Write、Edit。扩展工具是否只读需由其实现保证。 |
| `enableMcp` | 为子会话加载 Pi 的 MCP 实现；还需配置服务并把所需工具精确列入工具列表。 |

默认普通子任务有 `read, grep, find, ls, write, edit, bash` 和内部 `research_finish`。纯评审只有读取工具和 `research_finish`；评审成果由运行器写入。混合 Skills 的任务按普通任务处理，真正独立评审应单独调用 `research-review`。

`childExtensions` 只代表加载实现，`extraTools` / `reviewerTools` 决定模型能够使用的工具。provider 由主会话连接转发，通常不必再次加载 provider 扩展。

## 搜索扩展

已验证的三包组合及固定版本安装方法见 [检索接入](retrieval.md)。`/research capabilities` 或 `research_workspace(action: "capabilities")` 显示当前模型、认证是否配置、主会话实际工具和子任务预期工具，不发起模型或搜索请求。子任务启动时才核对实际加载工具，随后严格激活所选工具集合。

先安装并配置选定的搜索工具，找到它的实际入口文件。例如以下是结构示例，必须替换路径并核对已安装版本的工具名称：

```json
{
  "childExtensions": ["/absolute/path/to/search-extension/index.ts"],
  "extraTools": ["web_search", "fetch_content"],
  "reviewerTools": ["web_search", "fetch_content"]
}
```

可选候选为 [pi-web-access](https://github.com/nicobailon/pi-web-access)。不要在工具未实际配置时要求子任务“自行假定搜索可用”。

## MCP

使用 Pi 原生 `.pi/mcp.json` / 用户 MCP 配置。在本项目设置 `enableMcp: true`，并把要调用的实际 `mcp__...` 工具名加入对应列表。这里不自动开放 codemode/tool_search，以避免绕过任务的精确工具集合。子会话启动后会检查工具是否可用。

运行期注册在主会话内存中的 MCP 服务不会自动复制；需要把服务配置持久化，或作为显式子扩展注册。第三方工具要响应 AbortSignal，否则外层取消可能需要等待该工具返回。

## 续接与停止

委派时传入 `resumeTaskId`，仍需给出目标、同样的 Skills、输入和本次完成条件。运行器使用该任务保存的确切会话，保持模型和工具配置不变。改变模型/工具集合时创建新任务并引用旧成果。

研究子会话的新 attempt 不自动重新执行旧实验。若要继续原 engine，应在新请求中明确给出旧 `method.md` 实验目录，并遵循 [engine 恢复说明](engine.md)。

`/research stop` 只控制本 runtime 的活动任务；其他进程的任务不能凭一个状态文件被当成已停止。进程意外退出后，状态查看会将已确认死亡的 owner 显示为 `interrupted`，恢复时再取得任务锁。

目录和工具约束是协作边界，不是操作系统沙箱。Bash 和第三方扩展仍有 Pi 进程权限；需要强隔离时在独立容器/用户下运行。第一版不提供 GPU 调度、脱离 TUI 的存活承诺或跨进程并发配额。
