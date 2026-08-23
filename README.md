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

在 Supabase SQL Editor 中执行 [`backend/supabase/schema.sql`](backend/supabase/schema.sql)，然后把 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` 填入服务器 `.env`。服务端密钥绝不能进入 GitHub Pages。

## 部署概览

1. 前端：构建 `frontend`，将 `dist` 发布至 GitHub Pages。
2. 后端：在个人服务器运行 Docker Compose，通过 Nginx / Cloudflare Tunnel 对外暴露 HTTPS API。
3. 数据：Supabase 免费 PostgreSQL + Storage，迁移中的 RLS 以已登录用户为边界。
