import { ArrowUpRight } from 'lucide-react';

/** 案例卡片：沿用活动卡片的尺寸和排版，只把内容换成案例。 */
export default function CaseCard({ item, onOpen }) {
  const hint = item.href ? '在新标签打开案例网址' : '预览案例封面';
  const body = (
    <>
      <span className="event-image-wrap">
        <img src={item.image} alt={item.alt || item.title} loading="lazy" />
        <span className="event-open" aria-hidden="true"><ArrowUpRight /></span>
      </span>
      <span className="event-copy">
        <strong>{item.title}</strong>
        {item.description ? <span className="case-description">{item.description}</span> : null}
        <span className="case-source">{item.eventTitle}</span>
      </span>
    </>
  );
  const label = `查看案例：${item.title}（${item.eventTitle}，${hint}）`;

  // 有链接的用真实 <a target="_blank">：不会被浏览器当弹窗拦截，右键也能复制地址。
  if (item.href) {
    return (
      <a className="event-card case-card" href={item.href} target="_blank" rel="noopener noreferrer" aria-label={label}>
        {body}
      </a>
    );
  }
  return (
    <button className="event-card case-card" type="button" onClick={() => onOpen(item)} aria-label={label}>
      {body}
    </button>
  );
}
