import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import AdminPageHeader from "../../components/admin/AdminPageHeader";
import CalendarControls from "../../components/admin/calendar/CalendarControls";
import CalendarGrid from "../../components/admin/calendar/CalendarGrid";
import GoogleCalendarPreview from "../../components/admin/calendar/GoogleCalendarPreview";
import BlockDateDialog from "../../components/admin/calendar/BlockDateDialog";
import OcularVisitDialog from "../../components/admin/calendar/OcularVisitDialog";
import OcularVisitManagementDialog from '../../components/admin/calendar/OcularVisitManagementDialog';
import { useCalendarData } from "../../hooks/useCalendarData";
import type { AvailabilityBlock } from "../../types/admin";
import type { CalendarView, OcularVisit } from "../../types/calendar";
import { addDays, calendarCategories, calendarDays, calendarEvents, manilaDate, moveCalendar } from "../../utils/adminCalendar";
import "../../components/admin/calendar/calendar.css";

type Modal = { type: 'ocular-create' } | { type: 'ocular-details'; visitId: number } | { type: "block"; block?: AvailabilityBlock; details?: boolean } | null;

export default function AdminCalendarPage() {
    const [searchParams] = useSearchParams();
    const requestedDate = searchParams.get('date');
    const [view, setView] = useState<CalendarView>("Month");
    const [cursor, setCursor] = useState(() => requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : manilaDate());
    const [now, setNow] = useState(Date.now);
    const [modal, setModal] = useState<Modal>(null);
    const [notice, setNotice] = useState("");
    const days = calendarDays(cursor, view);
    const { state, reload, updateOcularVisit } = useCalendarData(days[0], addDays(days[days.length - 1], 1));
    const events = state.status === "ready" ? calendarEvents(state.data, now) : [];
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    function ocularSaved(date: string) {
        setCursor(date); setModal(null); setNotice('The ocular visit was scheduled successfully.'); reload();
    }
    function ocularChanged(message: string, visit: OcularVisit) {
        setNotice(message); updateOcularVisit(visit); setCursor(visit.visit_date); reload();
    }
    function saved(date?: string) {
        if (date) setCursor(date);
        setModal(null); setNotice("The date block was updated successfully."); reload();
    }

    return <div className="admin-calendar">
        <AdminPageHeader title="Centralized Calendar" copy="The official single-villa schedule, showing secured reservations separately from temporary opportunities."
            action={<div className="button-row"><button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'ocular-create' })}>Schedule Ocular Visit</button>
                <button type="button" className="btn btn-danger" onClick={() => setModal({ type: "block" })}>Block Date</button></div>} />
        <div className="calendar-legend calendar-legend-top" aria-label="Calendar status legend">
            {calendarCategories.map(category => <span key={category.key}><i className={`${category.key}-dot`} />{category.label}</span>)}
        </div>
        {notice && <p role="status" className="calendar-notice">{notice}</p>}
        <section className="calendar panel" aria-label="Villa calendar" aria-busy={state.status === "loading"}>
            <CalendarControls cursor={cursor} view={view} onMove={direction => setCursor(current => moveCalendar(current, view, direction))}
                onToday={() => { setCursor(manilaDate()); setNow(Date.now()); }} onView={setView} />
            {state.status === "ready" ? <CalendarGrid cursor={cursor} today={manilaDate(now)} days={days} events={events} view={view}
                onDate={day => { setCursor(day); setView("Day"); }} onBlock={block => setModal({ type: "block", block, details: true })}
                onOcular={visitId => setModal({ type: 'ocular-details', visitId })} />
                : state.status === "error" ? <div className="calendar-message" role="alert"><p>{state.message}</p><button type="button" className="btn btn-secondary" onClick={reload}>Try again</button></div>
                    : <p role="status" className="calendar-message">Loading calendar…</p>}
        </section>
        {state.status === "ready" && <GoogleCalendarPreview events={events} />}
        <p className="calendar-footnote">All times are Asia/Manila. Events cover the selected period.
            Reservation changes sync to Google Calendar approximately every minute
            while synchronization is running. Blocked dates and ocular visits
            are not yet synchronized.</p>
        <button type="button" className="calendar-refresh" onClick={reload}>Refresh calendar</button>
        {modal?.type === 'ocular-create' && <OcularVisitDialog date={cursor} onClose={() => setModal(null)} onSaved={ocularSaved} />}
        {modal?.type === 'ocular-details' && <OcularVisitManagementDialog visitId={modal.visitId} onClose={() => setModal(null)} onChanged={ocularChanged} />}
        {modal?.type === "block" && <BlockDateDialog date={modal.block?.starts_on ?? cursor} block={modal.block} details={modal.details} onClose={() => setModal(null)} onSaved={saved} />}
    </div>;
}
