import {
  RiCheckboxCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiInformationLine,
} from '@remixicon/react';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useI18n } from '../../i18n';
import { Button } from '../button';

import './style.css';

const TOAST_DURATION = 5000;

export type ToastVariant = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

const VARIANT_ICONS = {
  error: RiErrorWarningLine,
  success: RiCheckboxCircleLine,
  info: RiInformationLine,
};

const ToastContext = createContext<ToastApi>({
  error: () => {},
  success: () => {},
  info: () => {},
});

/**
 * 全局提示用于服务端与网络结果等非字段反馈，表单内只展示字段错误。
 */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const region = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(current =>
      current.map(item => (item.id === id ? { ...item, leaving: true } : item)),
    );
  }, []);

  const remove = useCallback((id: number) => {
    setToasts(current => current.filter(item => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = ++nextId.current;

      setToasts(current => [
        ...current,
        { id, message, variant, leaving: false },
      ]);
      window.setTimeout(() => dismiss(id), TOAST_DURATION);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      error: message => show(message, 'error'),
      success: message => show(message, 'success'),
      info: message => show(message, 'info'),
    }),
    [show],
  );

  // 用 popover 提升到最上层，弹窗打开时提示也能看见
  useEffect(() => {
    const element = region.current;

    if (!element) {
      return;
    }

    if (toasts.length > 0 && !element.matches(':popover-open')) {
      element.showPopover();
    }

    if (toasts.length === 0 && element.matches(':popover-open')) {
      element.hidePopover();
    }
  }, [toasts]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        ref={region}
        className="toast-region"
        popover="manual"
        aria-label={t('ui.notifications')}
      >
        {toasts.map(item => {
          const Icon = VARIANT_ICONS[item.variant];

          return (
            <div
              key={item.id}
              className={item.leaving ? 'toast toast-leaving' : 'toast'}
              data-variant={item.variant}
              role="alert"
              onAnimationEnd={event => {
                if (item.leaving && event.animationName === 'toast-leave') {
                  remove(item.id);
                }
              }}
            >
              <Icon size={20} aria-hidden />
              <p>{item.message}</p>
              <Button
                variant="icon"
                className="toast-close"
                onClick={() => dismiss(item.id)}
                aria-label={t('ui.close')}
              >
                <RiCloseLine size={20} aria-hidden />
              </Button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
