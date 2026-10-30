/**
 * Cloudflare 平台限制，客户端与 Worker 共用。
 * 数值以 Cloudflare 官方文档为准，不在业务代码中另立数值。
 */
export const D1_MAX_ROW_BYTES = 2_000_000;
export const EMAIL_MAX_BYTES = 5 * 1024 * 1024;
export const INBOUND_MAX_BYTES = 25 * 1024 * 1024;
export const MAX_RECIPIENTS = 50;
export const MAX_SUBJECT_LENGTH = 998;
export const MAX_ATTACHMENTS = 32;
export const MAIL_RETENTION_DAYS = 30;

export const MAX_TEMPLATE_BYTES = D1_MAX_ROW_BYTES;
export const MAX_IMAGE_BYTES = EMAIL_MAX_BYTES;
