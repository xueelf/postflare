import { useEffect, useRef, useState } from 'react';

import { FormItem } from '../../components/form-item';

export interface ConfirmPasswordFieldProps {
  password: string;
}

/**
 * 确认密码：两次不一致交给原生校验，浏览器气泡展示文案。
 */
export function ConfirmPasswordField({ password }: ConfirmPasswordFieldProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.setCustomValidity(
      password && value && password !== value ? '两次输入的密码不一致' : '',
    );
  }, [password, value]);

  return (
    <FormItem label="确认密码">
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
