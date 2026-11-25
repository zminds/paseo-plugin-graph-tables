Graph & Tables 在 Paseo 的智能体对话时间线和工作区面板中渲染交互式表格、图表、KPI 指标卡、甘特时间线、热力图、活跃度日历、色板、代码视图以及自动布局架构流程图。

本插件参考并适配 [Beluga](https://github.com/beluga-labs/beluga) 的视图与图形交互模型，面向 Paseo 插件子进程与跨平台客户端运行时重新实现，支持两种输出方式：

1. 内联代码块与 Markdown 表格升级：智能体可以直接在回复中输出 `paseo-view`、`beluga-view`、`paseo-graph` 或 `beluga-graph` JSON 代码块；开启自动升级后，回复中的多行 Markdown 表格也会转为可排序、可搜索、可展开单行详情的交互表格。
2. 工具驱动视图：处理较大数据集或实时查询时，智能体可调用 `show_view` 工具在守护进程侧执行数据源并将行数据缓存在插件进程内存中，仅向时间线返回短令牌 `<<paseo-view:...>>`。客户端随后可直接排序、筛选、搜索、分页、在表格与图表之间切换并刷新数据，避免撑大对话上下文。

## 通过 Skills 自动渲染（请勿禁用 Skills）

对话回复中的流程图、图表和交互式视图依赖插件同步的 `paseo-graph-tables` 技能自动触发渲染。插件启用后，会自动将 `paseo-graph-tables/SKILL.md` 同步到本机的全局技能目录：

- `~/.agents/skills/paseo-graph-tables/SKILL.md`
- `~/.claude/skills/paseo-graph-tables/SKILL.md`
- `~/.gemini/config/skills/paseo-graph-tables/SKILL.md`

智能体会读取该 Skill（在支持 `agent.open.before` 钩子的 Provider 上还会同步注入提示词），从而在合适场景自动输出 `paseo-view` / `paseo-graph` 代码块或调用 `show_view`。对于不接收 `appendSystemPrompt` 的 ACP 类型 Provider，自动渲染完全依赖该 Skill 生效。

为保证自动渲染正常工作，请勿禁用 Skills：

- 在 **设置 -> Graph & Tables** 中保持 **Install global agent SKILL.md**（全局技能同步）开启。关闭该开关会删除插件托管的 `SKILL.md` 文件；可在设置页点击 **Sync now** 核对各目录状态均为 `installed`。
- 不要在 Codex、Claude Code、Gemini CLI、Pi 等智能体或 Provider 设置中禁用 Skills 功能，也不要关闭 `paseo-graph-tables` 技能。
- 一旦禁用 Skills，智能体将无法获知视图与流程图协议，回复会退回普通文本，不会自动渲染交互图表或流程图。

## 支持的视图与控件

- 交互式表格（`table`）：支持排序、搜索、分页、字段类型徽章与链接、展开单行手风琴预览与逐字段复制、导出 CSV/Markdown、一键切换为图表，以及自动升级对话中的 Markdown 表格。
- 多种图表（`chart`）：支持柱状图（含堆叠）、平滑折线图、面积图（含堆叠）、饼图、环形图与散点图（`bar`、`line`、`area`、`pie`、`donut`、`scatter`），支持一键切换图表类型、图例筛选、悬停或点按读数以及导出 SVG/PNG。
- 自动布局流程图（`graph`）：分层 DAG 自动布局、分组容器、18 种节点类型（含 `client`、`service`、`worker`、`queue`、`database` 字段表、`decision` 分支、`task` 清单与 `metric` 指标）、多种语义连线、拖拽节点与分组、步骤导览、点击节点查看 Markdown 详情、横竖排切换以及导出 SVG/PNG。
- 扩展视图：`stats`（带趋势迷你图与涨跌极性的 KPI 指标卡）、`gantt`（带进度条与菱形里程碑的甘特排期）、`heatmap`（热力图）、`calendar`（活跃度日历）、`colors`（色板）与 `code`（代码视图）。
- 交互控件：支持 `buttons`、`select`、`number`、`toggle` 和 `search`，并可将 `{{controlId}}` 参数安全代入数据源查询、URL、命令或脚本中。
- 工作区面板：打开 **Views** 面板可并排查看和刷新运行中的实时视图，内置 **Demo Gallery** 覆盖全部视图类型与多分组复杂流程示例。

## 配置与数据源权限

打开 **设置 -> Graph & Tables**，可配置全局技能同步、提示词注入、`show_view` 工具、Markdown 表格自动升级、行数上限、导出目录以及动态数据源开关。

文件（`file`）、目录（`folder`）和 HTTP（`http`）数据源默认关闭，需手动开启后才可运行。SQLite 默认开启，并通过 Node 的只读 SQL 接口执行，仅接受单条 SQL 语句，不接受 `.shell`、`.read` 等 sqlite3 客户端命令。PostgreSQL（通过 `psql` 运行，从 `.env` 或环境变量解析连接串）、Shell 命令（`command`）与内联脚本（`python`、`node`、`sh`、`bash`、`ruby`、`perl`）默认保持关闭，需明确开启后才会启用。

调用 `show_view` 时，结果中的简短行预览会随本轮对话发送给智能体及其模型服务商。插件在守护进程所在主机的内存中最多保留 200 条视图定义（含 HTTP 请求头等数据源配置）及其加载的行数据，达到上限后按最近最少使用顺序淘汰。重载或停止插件（包括重启守护进程）会清空内存缓存，过期视图重新调用 `show_view` 即可重建。导出文件会单独写入你配置的导出目录。

早期版本可能在守护进程的系统临时目录下遗留 `paseo-graph-tables-views` 目录。停止旧版插件后，主机所有者可自行删除该目录以清理历史快照。

## 兼容性与平台说明

- 需要 Paseo `0.14.0` 或更高版本，以支持 `agent.open.before` 提示词/工具钩子与 `Markdown` 渲染组件。
- 插件注册 ID 为 `agent-graph-tables`，便于其定向视图与流程图转换器先于 `better-paseo` 等通用时间线插件生效，同时保持普通消息和其他工具调用原样透传。
- 技能同步时会保留目标目录中已有的符号链接；需注意 Codex 仅识别普通 `SKILL.md` 文件或技能目录软链，不识别单独的 `SKILL.md` 文件软链。
- 在 Web 与桌面端，图表与流程图使用交互式 SVG 渲染，并支持导出 SVG、PNG、CSV 和 Markdown；在 iOS 与 Android 端，视图使用 React Native 原生组件渲染。
