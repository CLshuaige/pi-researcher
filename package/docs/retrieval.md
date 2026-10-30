# 检索接入

在宿主安装目录通过 Pi 局部安装固定版本插件：

```bash
pi install npm:pi-ask-user@0.17.0
pi install npm:pi-web-access@0.45.0
pi install npm:@duskmoon/pi-academic-search@0.1.1
pi install npm:pi-arxivist@0.1.7
```

局部安装声明写入该目录 .pi/settings.json，插件位于 .pi/npm/node_modules/；个人安装使用 ~/.pi/agent/settings.json 和 ~/.pi/agent/npm/node_modules/。问答插件供交互会话使用，其余三包提供检索和全文工具；子会话需要实际加载所选工具的扩展。

## 子会话工具加载

本包提供已注册的 research-literature 角色，默认后台运行，通过普通 Extension 发现加载宿主已安装的检索插件。父会话安装了插件，并不代表前台子会话自动具备它们；前台执行或需要精确选择扩展时，宿主可通过 subagents.agentOverrides 的 extensions 指定实际入口。tools 列出允许使用的工具名称，不负责加载实现。具体规则见 [配置说明](subagents.md#extension-与工具)。

文献角色允许 web_search、fetch_content、get_search_content、academic_search、paper_lookup、paper_citations、download_pdf、fetch_arxiv，以及基本读写和 Bash 工具。宿主准备对应检索插件；显式配置扩展路径时解析为实际安装位置。主流程按 research-literature 名称调用该角色，缺少工具时如实报告。

## 学术源和凭据

六种优先来源为 `arxiv`（arXiv）、`openalex`（OpenAlex）、`semantic_scholar`（Semantic Scholar）、`crossref`（Crossref）、`pubmed`（PubMed）、`dblp`（DBLP Computer Science Bibliography）。项目配置使用完整标识 semantic_scholar，调用插件时映射到 semantic。`.pi/research-modules.json` 的 literature.sources 决定初始检索重点，不是白名单；可以通过跨源查找、摘要补全和网页补充相关研究。

文献子会话调用实际加载的 Academic 插件：academic_search 做优先源联合检索，paper_lookup 按 DOI/ID 核验元数据与摘要，paper_citations 追踪引用，必要时 download_pdf。查找和补全可能访问未列为优先的来源，产物记录实际来源。只有用户另有明确的禁止或预算要求时才收窄，并确认工具确能限制其内部调用。

### 后端填写 Key 的位置

业务参数与插件凭据分开使用既有格式：

| 内容 | 实际读取位置 | 谁读取 |
|---|---|---|
| 交互模式、优先学术源、writeReview | 当前项目 .pi/research-modules.json | Skill 通过 check-settings.mjs 读取 |
| 学术源 Key、可选联系邮箱 | PI_CODING_AGENT_DIR/academic-search.json | Academic 插件直接读取 |

[academic-search.json](../config/academic-search.json) 是后端配置模板，只有当前六源中支持 Key 的三个原生字段。后端接收前端输入后，合并写入实际运行配置；包内模板不会自动生效，插件也不会读取 research-modules.json 中的 Key。null 表示没有配置，可尝试环境变量或该服务支持的无 Key 访问，不能据此保证所有源可用。

| 服务 | 插件 JSON 字段 | 环境变量 |
|---|---|---|
| Semantic Scholar | semanticScholarApiKey | S2_API_KEY |
| OpenAlex | openAlexApiKey | OPENALEX_API_KEY |
| PubMed / NCBI | ncbiApiKey | NCBI_API_KEY |

arXiv、Crossref、DBLP 在当前插件中没有专用 API Key 字段。可选联系信息为 crossrefMailto / CROSSREF_MAILTO、openAlexMailto / OPENALEX_MAILTO；需要 Unpaywall 开放 PDF 查找时可配置 unpaywallEmail / UNPAYWALL_EMAIL。Key 不一定是付费凭据，认证与配额按服务实际返回处理；本项目尚无有效学术 Key，未验证这些源的认证成功。

后端应显式设置 PI_CODING_AGENT_DIR 为本用户/本次运行使用的 Pi agent 配置目录，在启动子 Pi 前写好 academic-search.json。未设置时，插件按 XDG_CONFIG_HOME/pi，再按 ~/.pi 查找；不能假定它与 Pi 默认 ~/.pi/agent 总是相同。后台原生子进程继承该变量；使用自定义 agent 目录时，应把需要的模型和认证配置也准备在那里。

已核对 0.1.1 的实际 credential-source.ts：普通字面量 JSON 值与对应环境变量同时存在时，非空环境变量优先。因此采用前端写 JSON 的模式时，不要让服务器遗留的全局学术 Key 环境变量覆盖当前用户输入；后端可在该 Pi 子进程环境中清除相应变量，或明确选择全部通过环境注入。模型 Key 的 BLSC_API_KEY / Pi auth.json 与这些学术 Key 独立。

插件还将以 $VAR / ${VAR} 开头的完整字符串解释为环境引用，以 ! 开头解释为命令来源。前端填写的是字面量 Key；若真的以 $ 或 ! 开头，后端按插件约定加前缀转义为 $$… / $!…，不要把前端输入作为命令来源。普通 Key 原样填写，不需要智能体手动读取或写进任务提示词。

该版本 provider 会缓存配置与已解析凭据。后端更新 Key 后新建对应子 Pi，或重新启动已加载插件的 Pi，不假定文件变化会立即更新在途请求。配置文件建议使用 0600 权限，不把 Key 写入科研产物。

## 网页与全文

网页模板使用 Exa → DuckDuckGo，`useCurrentModel:false`、`workflow:none`，关闭浏览器自动打开、cookie 和 GitHub clone。搜索后端独立于 Kimi 的原生联网功能；模型只需能调用工具。

论文优先读取 HTML，必要时用 `fetch_arxiv` 获取可读全文或按需下载 PDF。下载文件不等于读懂 PDF；扫描件、图表和公式依赖实际可用的提取或视觉能力。临时 resultId/responseId 不能代替长期 URL、DOI 和原文定位。

默认保存稳定链接、DOI 和必要笔记。工具临时获取或提取 PDF 后，不自动把完整转写稿复制到项目。确需离线、保留版本或复现时，再把必要副本存入 `literature/papers/` 等子目录并记录理由，不批量下载所有检索结果。LaTeX/PDF 编译归报告模块接入。

## 网络和失败

代理环境由宿主进程提供。Node 原生 fetch 需要使用环境代理时，可设置 NODE_USE_ENV_PROXY=1；本服务器 Node 22.23.1 已实际验证。网络变化后重新启动进程，并分别核对模型与检索请求。

401/403、429、超时、`details.error` 和 `failedSources` 均须作为来源失败处理，不能当零结果或完整覆盖。摘要、元数据、相关正文的阅读程度要如实记录。实际验证范围见 [验证说明](validation.md)。

academic-search.json 的文件名和读取规则由 pi-academic-search 插件的 src/utils.ts 定义；不是 pi-web-access 的配置。pi-web-access 使用 web-search.json。两者都尊重 PI_CODING_AGENT_DIR。
