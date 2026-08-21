# 项目交接 · Zhiwu OS

## 已完成什么

- 从空仓库搭建 Zhiwu OS V1：React + TypeScript + Vite 前端，以及 FastAPI 后端骨架。
- 完成登录页、个人 CEO Dashboard、外贸 CRM、客户详情/跟进、新建客户和产品中心的响应式界面与演示数据。
- 增加 Supabase Auth 登录代理，浏览器不接触服务端密钥；未配置账号时可进入演示工作空间。
- 提供 Supabase 数据库迁移：`customers`、`followups`、`products`，并开启对应 RLS 策略。
- 提供 Docker Compose、环境变量示例与 GitHub Pages/个人服务器/Supabase 部署说明。
- 前端已通过 TypeScript 和 Vite 生产构建；后端 Python 语法已验证。

## 当前卡在哪里

- 尚未创建或接入实际 Supabase 项目，因此登录、客户和产品目前展示本地演示数据，未连通真实数据库。
- 尚未填写个人服务器域名、Cloudflare Tunnel、Supabase 环境变量，因此没有部署到公网。
- V1 需求中的真实数据读写、跟进记录新增和任务持久化尚待 API 对接后完成。

## 下一步要做什么

1. 创建 Supabase 项目，在 SQL Editor 执行 `backend/supabase/schema.sql`，创建自己的登录账号。
2. 在个人服务器复制 `backend/.env.example` 为 `.env`，填写 Supabase 配置并运行 Docker Compose。
3. 配置 Nginx、Cloudflare Tunnel 和前端 `VITE_API_URL`，将前端 `dist` 发布到 GitHub Pages。
4. 将 CRM、产品库和跟进管理从演示数据改为调用 API，并补齐新增/编辑/删除与真实任务模块。
