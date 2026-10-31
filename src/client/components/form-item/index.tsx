import { RiQuestionFill, RiQuestionLine } from '@remixicon/react';
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useId,
} from 'react';

import './style.css';

// label 只能绑定可标记元素，绑定其它元素属于错用标签
const LABELABLE_TAGS = new Set([
  'button',
  'input',
  'meter',
  'output',
  'progress',
  'select',
  'textarea',
]);

export interface FormItemProps {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}

/**
 * 表单字段由标签、可选的字段说明与控件组成，校验交给浏览器原生能力。
 * 标签、帮助按钮和控件是兄弟节点，标签只绑定控件，不会把帮助按钮一起包进去。
 */
export function FormItem({ label, help, children }: FormItemProps) {
  const id = useId();
  const isControl =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    LABELABLE_TAGS.has(children.type);
  const controlId = isControl
    ? ((children as ReactElement<{ id?: string }>).props.id ?? id)
    : undefined;
  const control = isControl
    ? cloneElement(children as ReactElement<{ id?: string }>, {
        id: controlId,
      })
    : children;
  const labelContent = isControl ? (
    <label htmlFor={controlId}>{label}</label>
  ) : (
    <span>{label}</span>
  );

  return (
    <div className="form-item">
      <div className="form-label">
        {help ? (
          <span className="form-label-main">
            {labelContent}
            {help}
          </span>
        ) : (
          labelContent
        )}
      </div>
      {control}
    </div>
  );
}

export interface FormHelpProps {
  label: string;
  onClick: () => void;
}

/**
 * 字段说明是标签旁的小问号，点击区域就是图标本身。
 * hover 图标切换交给 CSS，不再依赖按钮是否被错误地包在 label 里。
 */
export function FormHelp({ label, onClick }: FormHelpProps) {
  return (
    <button
      type="button"
      className="form-help"
      onClick={onClick}
      aria-label={label}
    >
      <RiQuestionLine className="form-help-idle" size={16} aria-hidden />
      <RiQuestionFill className="form-help-active" size={16} aria-hidden />
    </button>
  );
}
