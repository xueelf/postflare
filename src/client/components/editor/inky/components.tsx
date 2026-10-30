import {
  RiBookmarkLine,
  RiCursorLine,
  RiEyeLine,
  RiImageLine,
  RiMenuLine,
  RiNotificationBadgeLine,
  RiQuoteText,
  RiStickyNoteLine,
  RiVideoLine,
} from '@remixicon/react';

import type { MessageKey } from '#/client/i18n';

export type InkyComponentType =
  | 'button'
  | 'badge'
  | 'callout'
  | 'alert'
  | 'blockquote'
  | 'image'
  | 'video'
  | 'menu'
  | 'preview';

export interface InkyComponentDefinition {
  label: MessageKey;
  icon: typeof RiCursorLine;
}

/**
 * 组件顺序对应 Inky Component Reference。
 * 界面文案使用翻译键，英文保留官方组件名。
 */
export const INKY_COMPONENT_ORDER: InkyComponentType[] = [
  'button',
  'callout',
  'menu',
  'image',
  'video',
  'alert',
  'badge',
  'blockquote',
  'preview',
];

export const INKY_COMPONENTS: Record<
  InkyComponentType,
  InkyComponentDefinition
> = {
  button: {
    label: 'compose.componentButton',
    icon: RiCursorLine,
  },
  callout: {
    label: 'compose.componentCallout',
    icon: RiStickyNoteLine,
  },
  menu: {
    label: 'compose.componentMenu',
    icon: RiMenuLine,
  },
  image: {
    label: 'compose.componentImage',
    icon: RiImageLine,
  },
  video: {
    label: 'compose.componentVideo',
    icon: RiVideoLine,
  },
  alert: {
    label: 'compose.componentAlert',
    icon: RiNotificationBadgeLine,
  },
  badge: {
    label: 'compose.componentBadge',
    icon: RiBookmarkLine,
  },
  blockquote: {
    label: 'compose.componentBlockquote',
    icon: RiQuoteText,
  },
  preview: {
    label: 'compose.componentPreview',
    icon: RiEyeLine,
  },
};
