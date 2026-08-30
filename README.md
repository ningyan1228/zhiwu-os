# Zhiwu OS

完整功能与使用方法请见：[PRODUCT_MANUAL.md](PRODUCT_MANUAL.md)。

一个为单人创业者设计的个人工作台 V1。当前版本覆盖 Dashboard、外贸 CRM、客户跟进和产品库，并提供可部署到个人服务器的 FastAPI API Gateway 骨架与 Supabase 数据库迁移。

## 本地运行

```powershell
cd frontend
npm install
npm run dev
```

前端默认使用内置演示数据；设置 `VITE_API_URL` 后会请求 API Gateway。

```powershell
cd backend
Copy-Item config.example .env
docker compose up --build
```

在 Supabase SQL Editor 中执行 [`backend/supabase/schema.sql`](backend/supabase/schema.sql)，然后按版本顺序执行 `backend/supabase/` 中的迁移文件；部署客户线索严格核验前必须执行 [`v1_19_cpph_2a_strict_import.sql`](backend/supabase/v1_19_cpph_2a_strict_import.sql)、[`v1_20_application_first_lead_discovery.sql`](backend/supabase/v1_20_application_first_lead_discovery.sql) 和 [`v1_21_dual_direction_discovery.sql`](backend/supabase/v1_21_dual_direction_discovery.sql)。把 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 填入服务器 `.env`。服务端密钥绝不能进入 GitHub Pages。

## CPPH-2A 严格名单导入

部署后，在“客户线索发现 → 严格客户核验”点击“导入严格 Excel”，选择人工核验的工作簿。系统只读取 `严格客户名单` 的 `A4:Q44`，并以官网主域名、公司名、邮箱、地址和 Excel ID 幂等更新；它只写入线索库，不会自动写入 CRM 或发送联系信息。导入完成后可在“严格客户名单”按 A/B 类查看卡片、点击来源链接，并通过“导出 Excel”导出当前严格名单。

## 应用优先发现

产品识别词只用于后端生成下游应用画像，绝不直接用来搜索客户。CPPH-2A 会展开为 PP/PE/TPO 基材的油墨、涂料、底涂和胶黏剂等应用，再按“下游应用 × 下游企业类型 × 国家/地区”搜索企业官网。官网售卖 CPP/CPO/树脂/附着力促进剂等原料的企业会作为同行进入排除名单；自动网页发现只会进入“待补信息”，不能直接进入严格名单或 CRM。

查询任务可选两种方向：`需求客户` 采用应用优先逻辑寻找下游潜在使用者；`供应工厂` 用产品名称/技术词检索中国大陆生产工厂，并排除贸易商、经销商、目录和媒体。供应工厂候选不会自动写入供应商中心。

## 部署概览

1. 前端：构建 `frontend`，将 `dist` 发布至 GitHub Pages。
2. 后端：在个人服务器运行 Docker Compose，通过 Nginx / Cloudflare Tunnel 对外暴露 HTTPS API。
3. 数据：Supabase 免费 PostgreSQL + Storage，迁移中的 RLS 以已登录用户为边界。
