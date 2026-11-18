# 阳光心材料页面整合（2026-11-17）

主入口是 https://work.101921.xyz 。客户开发、询盘往来、团队台账、产品技术资料、行业情报、外贸学习、回复助手、内容工作室和资料设置均在当前工作站打开。

## 实现和构建

`frontend/scripts/prepare-knowledge.mjs` 固定导入 knowledge-workbench 的公开提交 `6cd2454c533990a91166235ecfc5f74f06cddef1`。只复制 `src` 和存在时的 `public`；不复制私有导入、研究队列、凭据或后台数据库。生成目录不提交。

运行 `pnpm install --frozen-lockfile`、`pnpm prepare:knowledge`、`pnpm build`。本地可用 `KNOWLEDGE_SOURCE` 指向这个提交的已解压公开源码。升级时修改固定提交并重新检查适配器、类型、桌面和移动端；不得直接引用未审查的本地研究数据。

知识模块按需加载，通过 React portal 渲染在 Shadow DOM 内，沿用主站导航、主题和宽度。没有 iframe。原页面的 DOM 查询适配到模块根，保证详情焦点、弹窗和搜索正常。客户数据刷新仍读取原知识站的正式发布 manifest；内置数据来自固定公开提交。

`#work/<view>` 是工作站原页面；知识页面沿用 `#market-intelligence`、`#inquiries`、`#products`、`#practice` 等地址。旧知识站继续独立运行。

## 账号与私有数据

两个 Supabase 项目不同：工作站为 `lcytqicctxigcrhzcwag`，知识资料为 `lyozybqqgwnohqjtzmpx`。本版完成页面整合，尚未实现单点登录或客户数据合并。

首次在新域名使用私有资料，必须在「资料账号与设置」验证原资料账号。账号条始终显示资料邮箱；工作站个人菜单显示工作站邮箱。既有 RLS 和服务端台账权限保持。不得仅凭相同邮箱、显示名或 Peter 标签自动关联权限。

工作站显式退出或主站接口返回 401 时清理资料登录状态。旧站域名的浏览器会话不受新域名退出影响。

资料 API 的 ALLOWED_ORIGINS 增加 `https://work.101921.xyz`；修改前在原服务 backups 目录备份配置，保留原允许来源和数据卷。前端 knowledgeConfig 只有公开 URL、客户端 publishable key；无 service role key。

## 验证与回退

使用合成账号及拦截接口验证匿名不读询盘、已授权询盘显示、全部知识页面切换、原首页刷新、移动端宽度、单侧栏、无 iframe 和退出清理。真实账号生产数据仍需实际登录验证；本次不替用户登录、不发送邮件、不改写客户记录。

移除了原主站在空客户列表时自动 seedDemo 及用演示数据替代空结果的行为。空账号显示空数据，不写入示例客户。

回退可恢复本次修改前的主站文件与工作流，原知识站链接和数据仍可使用。跨域白名单的增加不改变数据库访问权限。
