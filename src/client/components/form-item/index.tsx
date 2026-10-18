import { RiQuestionFill, RiQuestionLine } from '@remixicon/react';
import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
  useId,
  useState,
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
  children: ReactNode;
}

/**
 * 表单字段：标签 + 控件。校验交给浏览器原生能力（required/minLength 等）。
 * label 显式绑定控件：否则标签行里的按钮会成为 labeled control，点标签会触发它。
 */
export function FormItem({ label, children }: FormItemProps) {
  const id = useId();
  const isControl =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    LABELABLE_TAGS.has(children.type);

  const body = (
    <>
      <span className="form-label">{label}</span>
      {isControl
        ? cloneElement(children as ReactElement<{ id?: string }>, {
            id: (children as ReactElement<{ id?: string }>).props.id ?? id,
          })
        : children}
    </>
  );

  return (
    <div className="form-item">
      {isControl ? <label htmlFor={id}>{body}</label> : body}
    </div>
  );
}

export interface FormHelpProps {
  label: string;
  onClick: () => void;
}

/**
 * 字段说明：标签旁的小问号，点击区域就是图标本身，hover 换成填充图标。
 * hover 用 mouseenter 判断：按钮在 <label> 里时，CSS :hover 会被浏览器扩到整行标签。
 */
export function FormHelp({ label, onClick }: FormHelpProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      className="form-help"
      onClick={onClick}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (
        <RiQuestionFill size={16} aria-hidden />
      ) : (
        <RiQuestionLine size={16} aria-hidden />
      )}
    </button>
  );
}
