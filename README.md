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

在 Supabase SQL Editor 中执行 [`backend/supabase/schema.sql`](backend/supabase/schema.sql)，然后按版本顺序执行 `backend/supabase/` 中的迁移文件；部署客户线索严格核验前必须执行 [`v1_19_cpph_2a_strict_import.sql`](backend/supabase/v1_19_cpph_2a_strict_import.sql)。把 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 填入服务器 `.env`。服务端密钥绝不能进入 GitHub Pages。

## CPPH-2A 严格名单导入

部署后，在“客户线索发现 → 严格客户核验”点击“导入严格 Excel”，选择人工核验的工作簿。系统只读取 `严格客户名单` 的 `A4:Q44`，并以官网主域名、公司名、邮箱、地址和 Excel ID 幂等更新；它只写入线索库，不会自动写入 CRM 或发送联系信息。导入完成后可在“严格客户名单”按 A/B 类查看卡片、点击来源链接，并通过“导出 Excel”导出当前严格名单。

## 部署概览

1. 前端：构建 `frontend`，将 `dist` 发布至 GitHub Pages。
2. 后端：在个人服务器运行 Docker Compose，通过 Nginx / Cloudflare Tunnel 对外暴露 HTTPS API。
3. 数据：Supabase 免费 PostgreSQL + Storage，迁移中的 RLS 以已登录用户为边界。
