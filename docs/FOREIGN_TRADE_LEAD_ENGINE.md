# 外贸客户线索采集 MVP

该模块是 Zhiwu OS 的增量功能：公开目录或用户 CSV 种子 → 合规官网核验 → 规则/可选 AI 分析 → 人工审核 → CRM → CSV 导出。它不登录 LinkedIn、Alibaba 或付费平台，不绕过 robots.txt、验证码、登录、Cloudflare 或付费墙，也不自动发信。

## 一次性数据库部署

在 Supabase SQL Editor 按既有迁移顺序执行 `backend/supabase/`。已使用 V1.13～V1.26 的环境只需继续执行：

```sql
-- backend/supabase/v1_27_foreign_trade_lead_engine.sql
```

V1.27 新增 `product_keywords`、`crawl_sources` 和 `domain_blocklist`，并扩展既有 `lead_search_tasks`、`lead_discovery_runs`、`customer_leads`。所有新表启用 RLS，`owner_user_id = auth.uid()`；API 始终携带用户 JWT，因此普通用户不能读取别人的规则、来源或黑名单。`customer_leads` 继续沿用原有 `user_id` RLS。

## 本地运行

```powershell
cd backend
Copy-Item .env.example .env
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

cd ../frontend
pnpm install
$env:VITE_API_URL = 'http://localhost:8000'
pnpm dev
```

生产环境使用 `backend/docker-compose.yml` 启动 API 和 `lead-discovery-service`。前端可以构建后发布至 GitHub Pages；`SUPABASE_SERVICE_ROLE_KEY`、搜索 API Key 与 AI Key 只能放在服务器 `backend/.env`，不得写入 `VITE_*`、前端代码或仓库。

## 配置与真实采集

1. 在“产品中心”维护产品画像和已确认的下游应用。
2. 通过 `POST /api/keywords` 维护英文、本地语言、排除词及权重；不把种子关键词硬编码在爬虫中。
3. 通过 `POST /api/sources` 保存展会、协会、行业目录或用户导入来源；也可在任务中填公开目录 URL。
4. 新建任务并选择产品、目标国家及候选数量。没有搜索 Key 时，系统仍可从任务 URL 或 CSV 种子工作。
5. CSV 使用 UTF-8，列名为 `website_url`（或 `website`/`source_url`）、可选 `company_name`、`country`，上传到 `POST /api/customer-leads/import-seeds` 的 multipart `task_id`。
6. 运行任务。每个 URL 均先做 SSRF 拦截、robots 检查、同域限制和低频顺序抓取；只访问首页及 About / Products / Applications / Industries / Contact 等高价值公开页面。
7. 审核后才可转入 CRM。系统不会自动建客户、自动发送邮件或把自动抓到的记录视为购买证明。

## 可选环境变量

- `BRAVE_SEARCH_API_KEY`：合规搜索 API。留空时不抓取搜索结果页，仅使用公开目录/种子。
- `AI_ENABLED=false`：默认规则模式。启用后需要 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`；AI 仅可在规则评分上调整 ±10，返回必须通过 Pydantic 校验，失败自动回退规则。
- `LEAD_DISCOVERY_USER_AGENT`、`LEAD_DISCOVERY_DELAY_SECONDS`：清晰的身份与低频限制。建议延迟不低于 2–5 秒。

## 验证命令

```powershell
cd backend
python -m unittest discover -s tests -v

cd ../frontend
pnpm run build
```

测试仅使用规则函数与公开/本地 fixture，不对真实网站进行压力测试。建议验收时用自己许可的公开企业目录或一份不含个人隐私的 CSV，检查：进度、暂停/继续/取消、域名去重、证据来源、审核、CRM 转入和 CSV 导出。

## 常见问题

- **任务没有发现候选**：配置公开目录 URL 或 CSV 种子；搜索 API Key 为空时不会抓取 Google/Bing 页面。
- **页面被跳过**：查看运行日志。robots 禁止、私网/非 HTTP URL、非企业页面和黑名单域名都会被刻意跳过。
- **AI 不可用**：保持 `AI_ENABLED=false`；规则模式仍能完成提取、评分和审核。
- **发现同一域名**：系统按根域名优先更新现有线索、保留所有来源证据；集团或子公司相似时会保留给人工判断，不会盲目合并 CRM 客户。
