import { useEffect, useRef } from 'react';

export interface BodyFrameProps {
  srcDoc: string;
  title: string;
}

/**
 * 邮件正文 iframe：白底渲染，高度跟着内容走，滚动交给外层容器，避免出现内层滚动条。
 * 沙箱只放行同源读取和弹窗，脚本、表单、顶层跳转全部禁止；远程资源由 CSP 拦截。
 * 文档由 useEmailBody 预先构建，这里只负责挂载和测高。
 */
export function BodyFrame({ srcDoc, title }: BodyFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current;

    if (!frame) {
      return;
    }
    let observer: ResizeObserver | null = null;

    const fit = () => {
      // 切换邮件或卸载时 iframe 文档可能已经销毁
      if (!frame.isConnected) {
        return;
      }
      const doc = frame.contentDocument;
      const root = doc?.documentElement;

      if (!doc || !root) {
        return;
      }
      // 先归零再量，否则上一次的高度会把 scrollHeight 顶大，高度只增不减
      frame.style.height = '0px';

      const height = Math.max(root.scrollHeight, doc.body?.scrollHeight ?? 0);

      frame.style.height = `${height}px`;
    };
    const attach = () => {
      fit();
      observer?.disconnect();

      if (!frame.isConnected) {
        return;
      }
      const doc = frame.contentDocument;
      const root = doc?.documentElement;

      if (!doc || !root) {
        return;
      }
      observer = new ResizeObserver(fit);
      // documentElement 的高度是 iframe 视口，不会随内容增长，body 才会
      observer.observe(root);

      if (doc.body) {
        observer.observe(doc.body);
      }
    };

    frame.addEventListener('load', attach);
    // srcDoc 在挂载前已加载时不会再触发 load，先量一次
    attach();

    return () => {
      frame.removeEventListener('load', attach);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      className="body-html"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      scrolling="no"
      srcDoc={srcDoc}
      title={title}
    />
  );
}
