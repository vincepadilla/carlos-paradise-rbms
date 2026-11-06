import type { CalendarEvent } from "../../../types/calendar";
import { calendarBadge, calendarDateLabel, eventClass } from "../../../utils/adminCalendar";
import { Icon } from "../../reservations/ReservationUI";

export default function GoogleCalendarPreview({ events }: { events: CalendarEvent[] }) {
    const official = events.filter(event => event.category === "secured" || event.category === "completed");
    const internal = events.filter(event => !official.includes(event));
    return <section className="panel google-calendar-preview" aria-label="Google Calendar Synchronization Preview">
        <div className="panel-head"><div><span className="eyebrow">Integration Preview</span><h2>Google Calendar Synchronization Preview</h2>
            <p>Preview only — live Google Calendar synchronization is not connected.</p></div><span className="badge badge-neutral">Preview only</span></div>
        <div className="google-preview-grid">
            {[{ title: "Eligible to synchronize", items: official, internal: false, copy: "Official events that may be synchronized with Google Calendar" },
                { title: "Internal only — not synchronized", items: internal, internal: true, copy: "Temporary opportunities and queue entries that remain inside Carlos Paradise" }].map(column => <div className="google-preview-column" key={column.title}>
                <div className="google-preview-column-head"><div><h3>{column.title}</h3><p>{column.copy}</p></div>
                    <span className={`google-preview-scope${column.internal ? " internal" : ""}`}><Icon name={column.internal ? "shield" : "calendar"} size={14} />{column.internal ? "Internal system only" : "Google Calendar eligible"}</span></div>
                {column.items.map(event => <div className={`google-preview-event ${eventClass(event)}`} key={event.id}>
                    <span className={calendarBadge(event)}>{event.label}</span>
                    <div className="google-preview-identity"><b>{event.kind === "reservation" ? event.reservation.contact_name : event.title}</b><small>{event.kind === "reservation" ? event.reservation.reference : "Operational date block"}</small></div>
                    <div className="google-preview-details"><span>{calendarDateLabel(event.startsOn)}</span><small>{event.kind === "block" ? "Block synchronization policy is not configured" : event.timeLabel}</small></div>
                </div>)}
                {!column.items.length && <p className="preview-empty">No {column.internal ? "internal" : "official"} events in this period.</p>}
                <div className="google-preview-note"><Icon name="shield" size={14} /><p>{column.internal
                    ? "Temporary opportunities and queue entries are not synchronized as confirmed Google Calendar events. Blocks stay internal until a synchronization policy is configured."
                    : "This is an eligibility preview, not a synchronization action. Ocular scheduling is not connected yet."}</p></div>
            </div>)}
        </div>
    </section>;
}
