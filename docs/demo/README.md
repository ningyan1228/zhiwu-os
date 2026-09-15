# 演示数据

`lead-seeds-template.csv` 是字段格式示例，不是客户名单，域名使用保留示例域名。请不要把它当成真实采集来源运行。

真实验收时，请使用你获准访问的公开展会、协会或企业目录，或将其 URL 以 UTF-8 CSV 导入；列为：

- `website_url`（必填）
- `company_name`（可选）
- `country`（可选）

系统会先做 SSRF 和 robots 检查，之后才访问企业官网；不会采集登录后内容或私人联系方式。
