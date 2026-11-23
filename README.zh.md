# Postflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xueelf/postflare)

基于 [Cloudflare Workers](https://developers.cloudflare.com/workers/) 的自托管网页邮箱，收信由 [Email Routing](https://developers.cloudflare.com/email-routing/) 直接投递到 Worker，发信走 [Email Sending](https://developers.cloudflare.com/email-service/)，不需要 IMAP 或 SMTP 服务。邮件存储在 [D1 SQLite 数据库](https://developers.cloudflare.com/d1/)，附件存储在 [R2 对象存储](https://developers.cloudflare.com/r2/)。

使用其他语言阅读：[English](./README.md) | 中文

## 快速开始

点上面的 **Deploy to Cloudflare** 按钮。部署表单会创建 [D1 SQLite 数据库](https://developers.cloudflare.com/d1/)、[R2 对象存储](https://developers.cloudflare.com/r2/) 与 Worker，运行仓库里的 `deploy` 脚本完成数据库迁移与部署，并让你填写 `MAIL_DOMAIN`，也就是用来收发的域名。

你还需要：

1. 一个自己的域名
2. 一个 [Cloudflare](https://dash.cloudflare.com) 账号
3. [Workers 付费计划](https://developers.cloudflare.com/workers/platform/pricing/)，Email Sending 需要

应用要能收发邮件，还要在 Cloudflare 控制台完成以下配置：

1. **[Email Routing](https://developers.cloudflare.com/email-routing/)**：为域名启用，并添加一条 catch-all 规则指向本 Worker
2. **[Email Sending](https://developers.cloudflare.com/email-service/)**：为域名完成 Onboard

然后打开部署后的地址，初始化向导会检查域名的收信与发信就绪状态并创建所有者账号。更多账号在「用户」里创建。

## 界面语言

邮箱支持多种语言，与 Cloudflare 保持一致，共九种：

- Deutsch
- English
- Español
- Français
- Italiano
- Português
- 한국어
- 日本語
- 中文

## 模板与编辑器

模板保存的是 Inky 源码，发送和阅读使用编译器生成的 HTML。可视化模式支持常用 Inky 组件和样式，但不是任意 HTML 的完整编辑器。

如果模板包含可视化模式无法完整保留的结构，例如段落或标题的 `id`/`title`、带 class 或 style 的 span、原生 `<img>` 的 style/height、Alert/Callout 内的段落或列表、带 `media`/`type` 的 style，或完整文档的 doctype/html/body，编辑器会把可视化模式设为只读。此时请使用源码模式编辑和保存，源码会保持原样。

可视化画布复用作者样式，但它不是最终邮件预览。最终效果以模板阅读页、发送结果和实际邮件客户端为准。打开模板、切换模式、自动保存或冻结窗口都不会改写源码。

## 本地开发

在开发之前，请先做好以下准备工作：

- 一个 Cloudflare 账号
- Bun 1.4 或更高版本

`bun run dev` 会先生成绑定类型、应用本地数据库迁移，再构建并监听前端改动，同时启动 `wrangler dev`。

```sh
bun install
bun run dev
```

本地配置写在 `.dev.vars` 文件里，会覆盖 `wrangler.jsonc` 中的值：

```sh
MAIL_DOMAIN="example.com"
```

| 命令                        | 用途                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ |
| `bun run dev`               | 生成绑定类型，应用本地数据库迁移，构建并监听前端，启动 `http://127.0.0.1:8787` |
| `bun run build`             | 将生产版前端资源打包至 `dist/` 目录                                            |
| `bun run deploy`            | 应用线上数据库迁移并发布 Worker                                                |
| `bun run db:migrate:local`  | 将 `migrations/` 中的 SQL 应用至本地数据库                                     |
| `bun run db:migrate:remote` | 将 `migrations/` 中的 SQL 应用至线上数据库                                     |
| `bun test`                  | 运行单元测试                                                                   |
| `bun run typecheck`         | 生成绑定类型并运行 TypeScript 类型检查                                         |
| `bun run lint`              | 运行 ESLint 检查                                                               |
| `bun run format`            | 用 Prettier 格式化仓库                                                         |

Worker 的绑定类型由 `bun run types` 从 `wrangler.jsonc` 生成到 `types/`，`dev` 与 `typecheck` 会自动执行。

## 项目结构

```text
src/
  worker/        Worker 侧：路由、认证、用户、邮件、模板与收信
  client/        React 界面：视图、组件、Hooks
migrations/      D1 SQLite 数据库的表结构，按顺序应用
tests/           单元测试
types/           全局类型
scripts/         公共资源生成脚本
```

## 常见问题

| 现象               | 处理                                                           |
| ------------------ | -------------------------------------------------------------- |
| 收不到邮件         | 根域 MX 指向 Cloudflare Email Routing，catch-all 指向本 Worker |
| 发不出邮件         | 域名在 Email Service 完成 Onboard，账号有 Workers 付费计划     |
| 向导提示域名未就绪 | DNS 记录尚未生效，等几分钟后重试                               |
