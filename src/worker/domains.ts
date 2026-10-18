/**
 * 邮件域名从配置解析，用 DNS-over-HTTPS 检查收信与发信的就绪状态。
 * DoH 无需凭证，检查在 Worker 侧完成。
 */

export interface DomainStatus {
  name: string;
  receiving: boolean;
  sending: boolean;
}

/**
 * 配置的 MAIL_DOMAIN 可能带空白或大写，统一转成小写并去掉空白。
 */
export function parseMailDomain(value: string): string {
  return value.trim().toLowerCase();
}

// https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/
async function hasRecord(
  name: string,
  type: string,
  match: (data: string) => boolean,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: 'application/dns-json' } },
    );

    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { Answer?: Array<{ data: string }> };

    return (body.Answer ?? []).some(record => match(record.data));
  } catch {
    return false;
  }
}

/**
 * 检查域名的就绪状态，收信要求根域 MX 指向 Cloudflare（Email Routing），
 * 发信要求 cf-bounce 子域存在 MX（Email Service 已 Onboard）。
 */
export async function checkMailDomain(value: string): Promise<DomainStatus> {
  const name = parseMailDomain(value);

  if (!name) {
    return { name: '', receiving: false, sending: false };
  }

  // 两次 DoH 查询互不依赖，并行发出
  const [receiving, sending] = await Promise.all([
    hasRecord(name, 'MX', data =>
      data
        .toLowerCase()
        .trim()
        .replace(/\.$/, '')
        .endsWith('.mx.cloudflare.net'),
    ),
    hasRecord(`cf-bounce.${name}`, 'MX', () => true),
  ]);

  return { name, receiving, sending };
}
