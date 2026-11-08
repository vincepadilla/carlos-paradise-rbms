import type { CalendarCategory, CalendarData, CalendarEvent, CalendarView } from "../types/calendar";
import { dashboardTime } from "./adminDashboard.ts";

export const calendarCategories: { key: CalendarCategory; label: string; className: string }[] = [
    { key: "secured", label: "Ongoing / Secured", className: "confirmed-event" },
    { key: "completed", label: "Completed / Past", className: "completed-event" },
    { key: "opportunity", label: "Awaiting Deposit", className: "temporary-hold-event" },
    { key: "queue", label: "Internal Queue", className: "queue-count-event" },
    { key: "ocular", label: "Ocular Visit", className: "ocular-event" },
    { key: "blocked", label: "Blocked", className: "blocked-event" },
];
export const eventClass = (event: CalendarEvent) => calendarCategories.find(category => category.key === event.category)?.className ?? "";
export const calendarBadge = (event: CalendarEvent) => `badge badge-${({ secured: "green", completed: "neutral", opportunity: "amber", queue: "aqua", ocular: "aqua", blocked: "red" })[event.category]}`;

export function manilaDate(value: number = Date.now()): string {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
}

export const dateValue = (day: string) => new Date(`${day}T12:00:00Z`);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export function addDays(day: string, amount: number): string {
    const date = dateValue(day);
    date.setUTCDate(date.getUTCDate() + amount);
    return dateKey(date);
}
export function calendarDays(cursor: string, view: CalendarView): string[] {
    if (view === "Day") return [cursor];
    const first = view === "Month" ? `${cursor.slice(0, 7)}-01` : cursor;
    const start = addDays(first, -dateValue(first).getUTCDay());
    return Array.from({ length: view === "Month" ? 42 : 7 }, (_, index) => addDays(start, index));
}
export function moveCalendar(cursor: string, view: CalendarView, direction: number): string {
    if (view !== "Month") return addDays(cursor, direction * (view === "Week" ? 7 : 1));
    const date = dateValue(cursor);
    return dateKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1, 12)));
}
export const calendarDateLabel = (day: string, options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" }) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(dateValue(day));
export function calendarTitle(cursor: string, view: CalendarView): string {
    if (view === "Month") return calendarDateLabel(cursor, { month: "long", year: "numeric" });
    if (view === "Day") return calendarDateLabel(cursor, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const days = calendarDays(cursor, view);
    return `${calendarDateLabel(days[0], { month: "short", day: "numeric" })} – ${calendarDateLabel(days[6])}`;
}
export function blockDescription(text: string): { reason: string; notes: string } {
    const [reason, ...notes] = text.split("\n\n");
    return { reason, notes: notes.join("\n\n") };
}
export const blockReason = (reason: string, notes: string) => [reason.trim(), notes.trim()].filter(Boolean).join("\n\n");

export function calendarEvents(data: CalendarData, now = Date.now()): CalendarEvent[] {
    const events = data.reservations.flatMap<CalendarEvent>(reservation => {
        const start = Date.parse(reservation.starts_at), end = Date.parse(reservation.ends_at);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
        let category: CalendarCategory, label: string;
        if (reservation.status === "completed" || (["confirmed", "reserved"].includes(reservation.status) && end <= now)) {
            category = "completed"; label = reservation.status === "completed" ? "Completed" : "Past Reservation";
        } else if (["confirmed", "reserved"].includes(reservation.status)) {
            category = "secured"; label = start <= now ? "Ongoing Stay" : "Secured Reservation";
        } else if (["awaiting_deposit", "payment_review", "held"].includes(reservation.status)) {
            category = "opportunity"; label = reservation.status === "awaiting_deposit" ? "Awaiting Deposit" : reservation.status === "payment_review" ? "Payment Review" : "Held for Review";
        } else if (["queued", "pending"].includes(reservation.status)) {
            category = "queue"; label = reservation.status === "queued" ? "Internal Queue" : "Pending Review";
        } else return [];
        const timeLabel = `${dashboardTime(reservation.starts_at)} to ${dashboardTime(reservation.ends_at)}`;
        return [{ id: `reservation-${reservation.id}`, kind: "reservation", reservation, category, label,
            title: `${label} – ${reservation.contact_name} – ${timeLabel}`, timeLabel,
            startsOn: manilaDate(start), endsOn: addDays(manilaDate(end - 1), 1) }];
    });
    for (const block of data.blocks) {
        if (block.ends_on <= block.starts_on) continue;
        events.push({ id: `block-${block.id}`, kind: "block", block, category: "blocked", label: "Blocked",
            title: `Blocked · ${blockDescription(block.reason).reason}`, startsOn: block.starts_on, endsOn: block.ends_on, timeLabel: "All day" });
    }
    for (const visit of data.ocular_visits ?? []) {
        if (!visit.visit_date || visit.end_time <= visit.start_time) continue;
        const status = ({ pending_review: 'Pending Review', approved: 'Approved', cancelled: 'Cancelled' })[visit.status];
        const timeLabel = `${visit.start_time.slice(0, 5)} to ${visit.end_time.slice(0, 5)}`;
        events.push({ id: `ocular-${visit.id}`, kind: 'ocular', ocularVisit: visit, category: 'ocular', label: status,
            title: `Ocular Visit - ${visit.guest_name} - ${timeLabel}`, startsOn: visit.visit_date, endsOn: addDays(visit.visit_date, 1), timeLabel });
    }
    return events.sort((left, right) => left.startsOn.localeCompare(right.startsOn) || left.timeLabel.localeCompare(right.timeLabel));
}
export const eventsOnDate = (events: CalendarEvent[], day: string) => events.filter(event => event.startsOn <= day && event.endsOn > day);
export const eventHref = (event: CalendarEvent) => event.kind === "reservation"
    ? event.category === "queue" ? "/admin/queue" : `/admin/reservations/${event.reservation.id}` : undefined;
