import { useEffect } from 'react';

/**
 * Tab 在表单内按输入框循环，不在表单里时保留浏览器默认行为。
 */
export function useTabFields() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }
      const active = document.activeElement;

      if (!(active instanceof HTMLElement)) {
        return;
      }
      const form = active.closest('form');

      if (!form) {
        return;
      }
      const fields = [
        ...form.querySelectorAll<HTMLElement>('input, textarea, select'),
      ].filter(field => !field.hidden && !field.hasAttribute('disabled'));

      if (fields.length === 0) {
        return;
      }
      // 确认要接管再阻止默认行为，否则焦点在表单外会被完全卡住
      event.preventDefault();

      const current = fields.indexOf(active);
      const step = event.shiftKey ? -1 : 1;
      const index =
        current === -1
          ? event.shiftKey
            ? fields.length - 1
            : 0
          : (current + step + fields.length) % fields.length;

      fields[index]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
