import type { CalendarEvent, GoogleCalendarIntegration, GoogleSync } from '../../../types/calendar';
import { calendarBadge, calendarDateLabel, eventClass } from '../../../utils/adminCalendar';
import { Icon } from '../../reservations/ReservationUI';

const syncFor = (event: CalendarEvent): GoogleSync => event.kind === 'reservation'
    ? event.reservation.google_sync ?? { state: 'internal', synced_at: null }
    : event.kind === 'ocular'
        ? event.ocularVisit.google_sync ?? { state: event.ocularVisit.status === 'approved' ? 'pending' : 'internal', synced_at: null }
        : event.block.google_sync ?? { state: 'pending', synced_at: null };

export default function GoogleCalendarPreview({ events, integration }: { events: CalendarEvent[]; integration: GoogleCalendarIntegration }) {
    const synced = events.filter(event => syncFor(event).state === 'synced');
    const pending = events.filter(event => syncFor(event).state === 'pending');
    const internal = events.filter(event => syncFor(event).state === 'internal');
    const connection = !integration.configured ? 'Configuration incomplete'
        : !integration.connected ? 'Google account not connected' : 'Connected · one-way synchronization';
    const columns = [
        { title: 'Synchronized', items: synced, internal: false, copy: 'Mapped events successfully processed by Google Calendar' },
        { title: 'Pending synchronization', items: pending, internal: false, copy: 'Eligible changes waiting for the scheduler or a retry' },
        { title: 'Internal only', items: internal, internal: true, copy: 'Queue, deposit, payment-review, and pending ocular records' },
    ];

    return <section className='panel google-calendar-preview' aria-label='Google Calendar synchronization status'>
        <div className='panel-head'><div><span className='eyebrow'>Integration Status</span><h2>Google Calendar Synchronization</h2>
            <p>Database synchronization state for events in this range. Google is updated by the server scheduler.</p></div>
            <span className={`badge ${integration.configured && integration.connected ? 'badge-green' : 'badge-amber'}`}>{connection}</span></div>
        <div className='google-preview-grid'>
            {columns.map(column => <div className='google-preview-column' key={column.title}>
                <div className='google-preview-column-head'>
                    <div className='google-preview-column-title'><h3>{column.title}</h3>
                        <span className={`google-preview-scope${column.internal ? ' internal' : ''}`}><Icon name={column.internal ? 'shield' : 'calendar'} size={14} />{column.internal ? 'Not published' : column.title}</span></div>
                    <p>{column.copy}</p>
                </div>
                <div className={`google-preview-list${column.items.length ? '' : ' is-empty'}`}>
                    {column.items.map(event => <div className={`google-preview-event ${eventClass(event)}`} key={event.id}>
                        <span className={calendarBadge(event)}>{event.label}</span>
                        <div className='google-preview-identity'><b>{event.kind === 'reservation' ? event.reservation.contact_name : event.title}</b><small>{event.kind === 'reservation' ? event.reservation.reference : event.kind === 'ocular' ? `Ocular visit #${event.ocularVisit.id}` : `Date block #${event.block.id}`}</small></div>
                        <div className='google-preview-details'><span>{calendarDateLabel(event.startsOn)}</span><small>{event.timeLabel}</small></div>
                    </div>)}
                    {!column.items.length && <p className='preview-empty'>No events in this state for the selected period.</p>}
                </div>
            </div>)}
        </div>
        <div className='google-preview-note'><Icon name='shield' size={14} /><p>Confirmed, reserved, and completed reservations; approved ocular visits; and active blocks are published. Updates reuse their event mapping. Cancelled or expired reservations, cancelled ocular visits, and released blocks are removed on the next scheduler run.</p></div>
    </section>;
}
