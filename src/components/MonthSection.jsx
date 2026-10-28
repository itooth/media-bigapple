import EventCard from './EventCard.jsx';
import CaseCard from './CaseCard.jsx';

export default function MonthSection({ month, onOpen, kind = 'event', onOpenCase }) {
  return (
    <section className="month-section" aria-labelledby={`month-${month.label}`}>
      <h1 id={`month-${month.label}`}>{month.label}</h1>
      <div className="event-grid">
        {kind === 'case'
          ? month.events.map((item) => <CaseCard key={item.key} item={item} onOpen={onOpenCase} />)
          : month.events.map((event) => <EventCard key={event.uid || event.id} event={event} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
