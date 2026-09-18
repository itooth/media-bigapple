import { ArrowUpRight } from 'lucide-react';

export default function EventCard({ event, onOpen }) {
  return (
    <button className="event-card" type="button" onClick={() => onOpen(event)} aria-label={`查看活动：${event.partner}`}>
      <span className="event-image-wrap">
        {event.image ? <img src={event.image} alt={event.alt} loading="lazy" /> : <span className="event-image-placeholder">{event.partner}</span>}
        <span className="event-open" aria-hidden="true"><ArrowUpRight /></span>
      </span>
      <span className="event-copy">
        <strong>{event.partner}</strong>
        <span>{event.description}</span>
      </span>
    </button>
  );
}
