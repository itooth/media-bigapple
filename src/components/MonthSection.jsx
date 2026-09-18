import EventCard from './EventCard.jsx';

export default function MonthSection({ month, onOpen }) {
  return (
    <section className="month-section" aria-labelledby={`month-${month.label}`}>
      <h1 id={`month-${month.label}`}>{month.label}</h1>
      <div className="event-grid">
        {month.events.map((event) => <EventCard key={event.uid || event.id} event={event} onOpen={onOpen} />)}
      </div>
    </section>
  );
}
