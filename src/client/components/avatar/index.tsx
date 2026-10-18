import type { CSSProperties } from 'react';

import './style.css';

/**
 * 取名称首字符作为头像文字。
 */
function avatarLetter(name: string): string {
  return ([...name.trim()][0] ?? '?').toUpperCase();
}

/**
 * 按名称哈希生成头像配色（软底深字）。
 */
function avatarStyle(name: string): CSSProperties {
  let hash = 0;

  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  }
  const hue = Math.abs(hash) % 360;

  return {
    background: `hsl(${hue} 72% 91%)`,
    color: `hsl(${hue} 62% 40%)`,
  };
}

/**
 * 身份头像：名称首字符 + 哈希配色，装饰性元素（名称在旁时对辅助技术隐藏）。
 */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" style={avatarStyle(name)} aria-hidden="true">
      {avatarLetter(name)}
    </span>
  );
}
