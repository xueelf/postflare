export interface ListRowProps {
  selected: boolean;
  /** 未读态：邮件列表按文件夹与 seen 决定，模板列表不传 */
  unread?: boolean;
  title: string;
  subtitle?: string;
  text: string;
  dateTime: string;
  when: string;
  onOpen: () => void;
}

/**
 * 列表行：昵称与时间同排、可选地址行、末行标题，结构与邮件列表一致。
 */
export function ListRow({
  selected,
  unread,
  title,
  subtitle,
  text,
  dateTime,
  when,
  onOpen,
}: ListRowProps) {
  const classes = [
    selected ? 'selected' : '',
    unread === undefined ? '' : unread ? 'unread' : 'read',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <button
        type="button"
        className={classes || undefined}
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="row-main">
          <span className="row-top">
            <span className="correspondent">{title}</span>
            <time dateTime={dateTime}>{when}</time>
          </span>
          {subtitle && (
            <span className="correspondent-address">{subtitle}</span>
          )}
          <span className="row-subject">{text}</span>
        </span>
      </button>
    </li>
  );
}
