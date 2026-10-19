import { useEffect, useRef, useState } from 'react';

import { FormItem } from '#/client/components/form-item';
import { useI18n } from '#/client/i18n';

export interface ConfirmPasswordFieldProps {
  password: string;
}

/**
 * 确认密码：两次不一致交给原生校验，浏览器气泡展示文案。
 */
export function ConfirmPasswordField({ password }: ConfirmPasswordFieldProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.setCustomValidity(
      password && value && password !== value ? t('auth.passwordMismatch') : '',
    );
  }, [password, value, t]);

  return (
    <FormItem label={t('auth.confirmPassword')}>
      <input
        ref={ref}
        type="password"
        required
        autoComplete="new-password"
        onChange={event => setValue(event.target.value)}
      />
    </FormItem>
  );
}
