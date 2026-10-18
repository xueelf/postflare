/**
 * 界面语言：与 Cloudflare 控制台一致，不含繁体中文。
 * 客户端与 Worker 共用，保证服务端校验与界面选项同源。
 */
export const LOCALES = [
  'de',
  'en',
  'es',
  'fr',
  'it',
  'pt',
  'ko',
  'ja',
  'zh',
] as const;

export type Locale = (typeof LOCALES)[number];

/** 语言未匹配到时使用的语言 */
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** 语言标签匹配：zh-CN、pt-BR 这类标签取主语言，未匹配到回落默认语言 */
export function matchLocale(tag: string): Locale {
  const [language] = tag.toLowerCase().split('-');

  return LOCALES.find(locale => locale === language) ?? DEFAULT_LOCALE;
}
