import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * 外观主题：跟随系统 / 浅色 / 深色，持久化到 localStorage，
 * 解析结果写入 `data-color-scheme` 供 light-dark() 使用。
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    const stored = localStorage.getItem('postflare-theme');

    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;

      document.documentElement.dataset.colorScheme = resolved;
    };

    apply();
    media.addEventListener('change', apply);
    localStorage.setItem('postflare-theme', theme);

    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return { theme, setTheme };
}
