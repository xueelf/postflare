# Postflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xueelf/postflare)

A self-hosted webmail running on [Cloudflare Workers](https://developers.cloudflare.com/workers/). Incoming mail is delivered straight into the Worker by [Email Routing](https://developers.cloudflare.com/email-routing/), outgoing mail goes out through [Email Sending](https://developers.cloudflare.com/email-service/), and there is no IMAP or SMTP service to maintain. Messages are stored in [D1 SQLite Database](https://developers.cloudflare.com/d1/) and attachments in [R2 Object Storage](https://developers.cloudflare.com/r2/).

Read this in other languages: English | [中文](./README.zh.md)

## Quick start

Click the **Deploy to Cloudflare** button above. The deploy form creates the [D1 SQLite Database](https://developers.cloudflare.com/d1/), the [R2 Object Storage](https://developers.cloudflare.com/r2/) bucket, and the Worker, runs the repository's `deploy` script to apply database migrations and deploy, and asks you to fill in `MAIL_DOMAIN`, the domain you send and receive mail on.

You also need:

1. A domain you control
2. A [Cloudflare](https://dash.cloudflare.com) account
3. A [Workers paid plan](https://developers.cloudflare.com/workers/platform/pricing/), which Email Sending requires

Before the app can send and receive mail, finish these settings in the Cloudflare dashboard:

1. **[Email Routing](https://developers.cloudflare.com/email-routing/)**: enable it for your domain and add a catch-all rule pointing at this Worker
2. **[Email Sending](https://developers.cloudflare.com/email-service/)**: onboard the domain

Then open the deployed URL. The setup wizard checks the domain's receiving and sending readiness and creates the owner account. More accounts are created from the Users page.

## Interface language

Postflare supports multiple languages, the same nine as Cloudflare:

- Deutsch
- English
- Español
- Français
- Italiano
- Português
- 한국어
- 日本語
- 中文

## Local development

Before you start, prepare the following:

- A Cloudflare account
- A JavaScript runtime, such as Bun or Node.js

This project is developed with Bun. If you use Node.js, replace the package manager commands with the equivalent npm, pnpm, or yarn commands.

```sh
bun install
bun run dev
```

Local values go in a `.dev.vars` file, which overrides the values in `wrangler.jsonc`:

```sh
MAIL_DOMAIN="example.com"
```

| Command                     | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `bun run dev`               | Start the local server on `http://127.0.0.1:8787` and apply local migrations |
| `bun run build`             | Bundle the client assets into the `dist/` directory                          |
| `bun run deploy`            | Apply production database migrations and deploy the Worker                   |
| `bun run db:migrate:local`  | Apply the SQL files in `migrations/` to the local database                   |
| `bun run db:migrate:remote` | Apply the SQL files in `migrations/` to the production database              |
| `bun test`                  | Run the unit tests                                                           |
| `bun run typecheck`         | Generate the binding types and run the TypeScript checker                    |
| `bun run lint`              | Run ESLint                                                                   |
| `bun run format`            | Format the repository with Prettier                                          |

Worker binding types are generated from `wrangler.jsonc` into `types/` by `bun run types`, which `dev` and `typecheck` run for you.

## Project layout

```text
src/
  worker/        Worker side: routing, auth, users, messages, templates, inbound
  client/        React interface: views, components, hooks
migrations/      D1 SQLite Database schema, applied in order
tests/           Unit tests
types/           Global types
scripts/         Shared asset generation
```

## Troubleshooting

| Symptom                                    | Fix                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| No incoming mail                           | Apex MX must point at Cloudflare Email Routing, and the catch-all must point at this Worker |
| No outgoing mail                           | Onboard the domain under Email Service, and make sure the account has a Workers paid plan   |
| The wizard reports the domain is not ready | The DNS records have not taken effect yet. Wait a few minutes and retry                     |
