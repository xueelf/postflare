import { useEffect, useState } from 'react';

/**
 * 值防抖：delay 毫秒内只保留最后一次变更。
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
