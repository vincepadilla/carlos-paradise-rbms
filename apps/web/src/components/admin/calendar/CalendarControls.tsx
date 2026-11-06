import type { CalendarView } from "../../../types/calendar";
import { calendarTitle } from "../../../utils/adminCalendar";

export default function CalendarControls({ cursor, view, onMove, onToday, onView }: {
    cursor: string; view: CalendarView; onMove: (direction: number) => void; onToday: () => void; onView: (view: CalendarView) => void;
}) {
    return <div className="calendar-head">
        <button type="button" aria-label={`Previous ${view}`} onClick={() => onMove(-1)}>←</button>
        <h2 aria-live="polite">{calendarTitle(cursor, view)}</h2>
        <button type="button" aria-label={`Next ${view}`} onClick={() => onMove(1)}>→</button>
        <button type="button" className="today-button" onClick={onToday}>Today</button>
        <div className="view-switch calendar-views" aria-label="Calendar view">
            {(["Month", "Week", "Day"] as const).map(item => <button type="button" key={item} className={view === item ? "active" : ""}
                aria-pressed={view === item} onClick={() => onView(item)}>{item}</button>)}
        </div>
    </div>;
}
