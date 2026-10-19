/**
 * 界面文案：语言与 Cloudflare 控制台一致。
 * 登录后以账号的 language 为准，未登录读 localStorage，首次访问按浏览器语言匹配。
 */
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
} from 'react';

import { type Locale, DEFAULT_LOCALE, isLocale, matchLocale } from '#/locales';

import { de } from './de';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { pt } from './pt';
import { type MessageKey, zh } from './zh';

export type { MessageKey } from './zh';

export {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  LOCALES,
  matchLocale,
} from '#/locales';
export type MessageParams = Record<string, string | number>;

/** 语言选择列表的名称，各自用本语言书写 */
export const LOCALE_LABELS: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
};

const STORAGE_KEY = 'postflare-locale';
const CATALOGS: Record<Locale, Record<MessageKey, string>> = {
  de,
  en,
  es,
  fr,
  it,
  pt,
  ko,
  ja,
  zh,
};

function storedLocale(): Locale | null {
  const value = localStorage.getItem(STORAGE_KEY);

  return isLocale(value) ? value : null;
}

export function storeLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

/** 未登录时的初始语言：本地记录优先，其次浏览器语言 */
export function initialLocale(): Locale {
  return storedLocale() ?? matchLocale(navigator.language);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: MessageParams,
): string {
  const message = CATALOGS[locale][key] ?? zh[key];

  if (!params) {
    return message;
  }

  return message.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    storeLocale(locale);
  }, [locale]);

  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useI18n() {
  const locale = useContext(LocaleContext);
  const t = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );

  return { locale, t };
}
