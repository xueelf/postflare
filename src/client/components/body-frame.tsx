import { useEffect, useRef } from 'react';

import { emailHtml } from '#/client/format';

export interface BodyFrameProps {
  html: string;
  title: string;
}

/**
 * 邮件正文 iframe：白底渲染，高度跟着内容走，滚动交给外层容器，避免出现内层滚动条。
 */
export function BodyFrame({ html, title }: BodyFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current;

    if (!frame) {
      return;
    }
    let observer: ResizeObserver | null = null;

    const fit = () => {
      const doc = frame.contentDocument;

      if (doc) {
        // 先归零再量，否则上一次的高度会把 scrollHeight 顶大，高度只增不减
        frame.style.height = '0px';
        frame.style.height = `${doc.documentElement.scrollHeight}px`;
      }
    };
    const attach = () => {
      fit();
      observer?.disconnect();

      const doc = frame.contentDocument;

      if (doc) {
        observer = new ResizeObserver(fit);
        observer.observe(doc.documentElement);
      }
    };

    frame.addEventListener('load', attach);
    // srcDoc 在挂载前已加载时不会再触发 load，先量一次
    attach();

    return () => {
      frame.removeEventListener('load', attach);
      observer?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      className="body-html"
      sandbox="allow-same-origin"
      srcDoc={emailHtml(html)}
      title={title}
    />
  );
}
