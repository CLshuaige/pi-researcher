# 检索接入

本机已安装并固定：`pi-web-access@0.45.0`、`@duskmoon/pi-academic-search@0.1.1`、`pi-arxivist@0.1.7`。三包为外部依赖，researcher 分发包不捆绑它们的源码或缓存。

## 安装到其他机器

```bash
pi install npm:pi-web-access@0.45.0
pi install npm:@duskmoon/pi-academic-search@0.1.1
pi install npm:pi-arxivist@0.1.7
```

将 [全局研究配置示例](../examples/research-global.json) 合并到 Pi agent 目录的 `research.json`，将 [网页配置示例](../examples/web-search.json) 合并到同目录的 `web-search.json`。通常该目录为 `~/.pi/agent`；如果使用 `PI_CODING_AGENT_DIR`，以它为准。保留已有凭据和自定义设置。相对路径对应 Pi 的全局 npm 安装布局，其他安装位置需要调整。

重启 Pi 后，在项目目录执行 `/research capabilities`。该命令只检查配置，不验证服务端凭据或联网。开始新研究子任务即可使用检索组合。旧任务保留原来的工具配置指纹；增加工具后应创建新任务并引用旧成果，不强行续接旧配置。

## 工具分工

| 来源 | 普通子任务 | 纯评审子任务 |
|---|---|---|
| pi-web-access | web_search、fetch_content、get_search_content | 相同 |
| pi-academic-search | academic_search、paper_lookup、paper_citations、download_pdf | 前三项 |
| pi-arxivist | fetch_arxiv | 不启用；读取已有全文文件 |

主会话加载三包全部已启用工具；独立子会话仍只加载全局/项目显式列出的扩展。加载扩展后运行器重新应用准确工具列表，防止第三方自动激活下载或其他工具。download_pdf 在普通子任务中必须使用当前 attempt 内的绝对 outputDir；缺省路径、共享目录和其他任务目录会被阻止。

网页配置使用 Exa → DuckDuckGo，无额外密钥时通过 Exa MCP 搜索。显式限制搜索后端、设置 `workflow: none`，关闭 curator、自动摘要、浏览器 cookie 及 GitHub 专用 clone 路径；正文只允许 readable/raw。需要其他后端时再修改 allowedProviders 与 searchRouting，并配置对应服务凭据。

学术扩展自己的配置默认在 `~/.pi/academic-search.json`（受 `PI_CODING_AGENT_DIR` / XDG 环境影响），不在 research.json。可以按需提供 Semantic Scholar、OpenAlex 等凭据；本机没有新增任何服务密钥。无密钥访问可能限流，不代表所有数据源随时可用。

## 代理网络

本机已有小写 `http_proxy` / `https_proxy`，curl 使用它们，但 Node fetch 原先没有启用代理。可选扩展 `extensions/env-proxy/index.ts` 使用 Node >=24.14 的标准 `http.setGlobalProxyFromEnv()` 接口，使 Node fetch/HTTP 遵守现有代理环境并保留 NO_PROXY，额外绕过本机回环地址。不会保存或输出代理凭据。

本机由 `~/.pi/agent/extensions/research-network/index.ts` 加载；其他机器按网络需要显式加载该入口。它影响整个 Pi 进程，包括父子会话，不在每个子任务中重复设置。没有 HTTP(S) 代理环境时不做任何事。更改代理环境或移除此入口后重启 Pi；不要依赖运行中 reload 撤销全局 dispatcher。

标准启动方式也可使用 `NODE_USE_ENV_PROXY=1 pi`，但扩展依赖可能初始化自己的 HTTP 层；应以实际工具请求验证为准。[Node 官方说明](https://nodejs.org/download/release/v24.17.0/docs/api/http.html#httpsetglobalproxyfromenvproxyenv)

## 证据和错误

网页 responseId 与学术 resultId 都是临时引用，不作为长期成果。保存实际文本、元数据、URL 和章节/页码到 attempt 目录。arxivist 的缓存也是读取材料，需复制必要成果；LaTeX 转 Markdown 不等于已经核对 PDF 图表或页码。

学术包的一些错误通过 `details.error` 或 `failedSources` 返回，paper_lookup 还可能把上游失败显示为 not_found。检查来源错误和健康状态；只返回部分来源时不要宣称完整覆盖。429 应等待或换用其他数据源，不能解释为无相关文献。此版本检索工具没有通用分页游标，不支持直接宣称穷尽式检索。

## 维护

researcher 0.2.0 修复了模型桥接把子会话占位 Authorization header 传给父模型的问题。父 runtime 重新解析 API key、OAuth 和自定义 headers；不复制凭据到任务文件。升级三个外部包前检查工具名、manifest 入口、缓存、输出目录和取消行为，随后执行加载与少量公开检索验证。
