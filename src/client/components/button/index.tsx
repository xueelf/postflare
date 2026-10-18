import type { ComponentProps } from 'react';

import './style.css';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'default' | 'primary' | 'danger' | 'icon';
}

/**
 * 统一各变体的类名，默认 type="button"，避免在表单中意外提交。
 */
export function Button({
  variant = 'default',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  const classes = [
    variant === 'primary' ? 'primary' : '',
    variant === 'danger' ? 'danger' : '',
    variant === 'icon' ? 'icon-btn' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <button type={type} className={classes || undefined} {...props} />;
}
