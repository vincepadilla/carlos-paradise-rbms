import { Link } from "react-router";
import type { AvailabilityBlock } from "../../../types/admin";
import type { CalendarEvent, CalendarView } from "../../../types/calendar";
import { calendarBadge, calendarDateLabel, dateValue, eventClass, eventHref, eventsOnDate } from "../../../utils/adminCalendar";
import { Icon } from "../../reservations/ReservationUI";
import { dashboardDate } from "../../../utils/adminDashboard";

function EventAction({ event, onBlock, onOcular, detail = false }: { event: CalendarEvent; onBlock: (block: AvailabilityBlock) => void; onOcular: (id: number) => void; detail?: boolean }) {
    const className = `${detail ? "day-event" : "calendar-event"} ${eventClass(event)}`;
    if (event.kind === "block") return <button type="button" className={className} title={event.title} onClick={() => onBlock(event.block)}>{event.title}</button>;
    if (event.kind === "reservation") return <Link className={className} title={event.title} to={eventHref(event)!}>{event.title}</Link>;
    return <button type='button' className={className} title={event.title} onClick={() => onOcular(event.ocularVisit.id)}>{event.title}</button>;
}

export default function CalendarGrid({ days, cursor, today, view, events, onDate, onBlock, onOcular }: {
    days: string[]; cursor: string; today: string; view: CalendarView; events: CalendarEvent[];
    onDate: (day: string) => void; onBlock: (block: AvailabilityBlock) => void; onOcular: (id: number) => void;
}) {
    const dayEvents = eventsOnDate(events, cursor);
    return <>
        <div className="calendar-scroll" tabIndex={0} aria-label={`${view} calendar schedule`}>
            {view === "Month" && <div className="weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <b key={day}>{day}</b>)}</div>}
            <div className={view === "Day" ? "day-view" : `calendar-grid${view === "Week" ? " week-view" : ""}`}>
                {days.map(day => {
                    const items = eventsOnDate(events, day);
                    return <div data-date={day} key={day} className={`calendar-day${view === "Month" && day.slice(0, 7) !== cursor.slice(0, 7) ? " muted" : ""}${day === today ? " current-date" : ""}${items.some(item => item.kind === "block") ? " blocked-day" : ""}`}>
                        <button type="button" className="calendar-day-number" aria-label={`View ${calendarDateLabel(day)}`} aria-current={day === today ? "date" : undefined} onClick={() => onDate(day)}>
                            {view === "Week" ? calendarDateLabel(day, { weekday: "short", month: "short", day: "numeric" }) : dateValue(day).getUTCDate()}
                        </button>
                        {items.map(event => <EventAction key={event.id} event={event} onBlock={onBlock} onOcular={onOcular} />)}
                    </div>;
                })}
            </div>
        </div>
        {view === "Day" && <div className="day-schedule">
            {dayEvents.length ? dayEvents.map(event => <div className={eventClass(event)} key={event.id}>
                <span className={calendarBadge(event)}>{event.label}</span><h3>{event.kind === "reservation" ? event.reservation.contact_name : event.kind === "ocular" ? event.ocularVisit.guest_name : event.title}</h3>
                <p>{calendarDateLabel(event.startsOn)}{event.kind === "block" ? ` – ${calendarDateLabel(event.endsOn)} (exclusive)` : event.kind === "reservation" ? ` – ${dashboardDate(event.reservation.ends_at)}` : ""} · {event.timeLabel}</p>
                <EventAction event={event} onBlock={onBlock} onOcular={onOcular} detail />
            </div>) : <div className="empty-state"><Icon name="calendar" /><h3>No scheduled events</h3><p>No official booking, temporary opportunity, queue entry or blocked period is recorded for this day.</p></div>}
        </div>}
    </>;
}
