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

## 本地开发

需要 [Bun](https://bun.sh)。

```sh
bun install
bun run db:migrate:local
bun run dev
```

本地配置写在 `.dev.vars` 文件里，会覆盖 `wrangler.jsonc` 中的值：

```sh
MAIL_DOMAIN="example.com"
```

| 命令                        | 用途                                     |
| --------------------------- | ---------------------------------------- |
| `bun run dev`               | 开发服务器，监听 `http://127.0.0.1:8787` |
| `bun run build`             | 构建客户端资源到 `dist/`                 |
| `bun run deploy`            | 构建、应用远端数据库迁移并部署           |
| `bun run db:migrate:local`  | 应用迁移到本地数据库                     |
| `bun run db:migrate:remote` | 应用迁移到远端数据库                     |
| `bun test`                  | 单元测试                                 |
| `bun run typecheck`         | TypeScript 类型检查                      |
| `bun run lint`              | ESLint                                   |
| `bun run format`            | Prettier                                 |

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
