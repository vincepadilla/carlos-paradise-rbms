import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AdminApi } from '../../../services/AdminApi';
import { ReservationApiError } from '../../../services/ReservationApi';
import type { OcularVisit, OcularVisitUpdate } from '../../../types/calendar';
import { calendarDateLabel, manilaDate } from '../../../utils/adminCalendar';
import { useAdminSession } from '../../auth/RequireAdmin';
import CalendarDialog from './CalendarDialog';

type Mode = 'details' | 'approve' | 'edit' | 'confirm-edit' | 'cancel';
type EditFields = Omit<OcularVisitUpdate, 'revision'>;
const sources = ['Facebook Messenger', 'TikTok', 'Instagram', 'WhatsApp', 'Phone Call'];
const statusText = { pending_review: 'Awaiting Approval', approved: 'Approved', cancelled: 'Cancelled' } as const;

function timeLabel(value: string) {
    const [hour, minute] = value.slice(0, 5).split(':').map(Number);
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
        .format(new Date(Date.UTC(1970, 0, 1, hour - 8, minute)));
}
function scheduleLabel(visit: Pick<OcularVisit, 'visit_date' | 'start_time' | 'end_time'>) {
    return `${calendarDateLabel(visit.visit_date)}, ${timeLabel(visit.start_time)}–${timeLabel(visit.end_time)}`;
}
function fieldsFrom(visit: OcularVisit): EditFields {
    return { guest_name: visit.guest_name, contact_details: visit.contact_details, visit_date: visit.visit_date,
        start_time: visit.start_time.slice(0, 5), end_time: visit.end_time.slice(0, 5),
        inquiry_source: visit.inquiry_source ?? '', notes: visit.notes ?? '' };
}

export default function OcularVisitManagementDialog({ visitId, onClose, onChanged }: {
    visitId: number; onClose: () => void; onChanged: (message: string, visit: OcularVisit) => void;
}) {
    const session = useAdminSession();
    const [visit, setVisit] = useState<OcularVisit | null>(null);
    const [mode, setMode] = useState<Mode>('details');
    const [draft, setDraft] = useState<EditFields | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const submitting = useRef(false);
    const panel = useRef<HTMLDivElement>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await AdminApi.ocularVisit(visitId, signal);
            setVisit(response.ocular_visit); setDraft(fieldsFrom(response.ocular_visit));
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === 'AbortError') return;
            if (cause instanceof ReservationApiError && cause.status === 401) session.clear();
            if (cause instanceof ReservationApiError && cause.status === 403) session.revalidate();
            setError(cause instanceof Error ? cause.message : 'Unable to load this ocular visit.');
        } finally { if (!signal?.aborted) setLoading(false); }
    }, [visitId, session]);

    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect -- the async fetch owns the loading result for this visit ID.
        const controller = new AbortController(); void load(controller.signal);
        return () => controller.abort();
    }, [load]);
    useEffect(() => {
        const timer = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 0);
        return () => window.clearTimeout(timer);
    }, [mode]);

    const title = mode === 'approve' ? 'Approve ocular visit?' : mode === 'cancel' ? 'Cancel ocular visit?'
        : mode === 'edit' ? 'Reschedule ocular visit' : mode === 'confirm-edit' ? 'Confirm revised schedule' : 'Ocular Visit Details';
    const disabled = !visit || visit.status === 'cancelled';
    const updateDraft = (key: keyof EditFields, value: string) => setDraft(current => current ? { ...current, [key]: value } : current);

    async function mutate(operation: () => Promise<{ ocular_visit: OcularVisit }>, message: string, close = false) {
        if (submitting.current) return;
        submitting.current = true; setBusy(true); setError(''); setSuccess('');
        try {
            const response = await operation();
            setVisit(response.ocular_visit); setDraft(fieldsFrom(response.ocular_visit));
            onChanged(message, response.ocular_visit);
            if (close) onClose(); else { setSuccess(message); setMode('details'); }
        } catch (cause) {
            if (cause instanceof ReservationApiError && cause.status === 401) session.clear();
            if (cause instanceof ReservationApiError && cause.status === 403) session.revalidate();
            if (cause instanceof ReservationApiError && cause.status === 409) {
                await load(); setError(`${cause.message} The latest details have been loaded.`); setMode('details');
            } else setError(cause instanceof Error ? cause.message : 'The ocular visit could not be updated.');
        } finally { submitting.current = false; setBusy(false); }
    }

    function reviewEdit(event: FormEvent) {
        event.preventDefault(); setError('');
        if (!draft) return;
        if (draft.end_time <= draft.start_time) return setError('End time must be later than start time.');
        if (Date.parse(`${draft.visit_date}T${draft.start_time}:00+08:00`) <= Date.now()) return setError('The ocular visit must be scheduled in the future.');
        setMode('confirm-edit');
    }

    const details = useMemo(() => visit ? [
        ['Contact', visit.contact_details], ['Schedule', scheduleLabel(visit)],
        ['Inquiry Source', visit.inquiry_source || 'Not provided'], ['Created By', visit.creator_name],
    ] : [], [visit]);

    return <CalendarDialog title={title} className='ocular-management-modal' busy={busy} onClose={onClose}>
        <div ref={panel} className='ocular-management-content' aria-busy={loading || busy}>
            {loading ? <p role='status' className='calendar-message'>Loading visit details…</p>
                : !visit ? <><p role='alert' className='form-error'>{error || 'This ocular visit is unavailable.'}</p>
                    <div className='button-row'><button data-autofocus type='button' className='btn btn-secondary' onClick={() => { setLoading(true); setError(''); void load(); }}>Try Again</button><button type='button' className='btn btn-ghost' onClick={onClose}>Close</button></div></>
                    : mode === 'approve' ? <div className='ocular-confirmation'>
                        <p>Confirm approval of this ocular visit for {scheduleLabel(visit)}.</p>
                        {error && <p role='alert' className='form-error'>{error}</p>}
                        <div className='button-row'><button data-autofocus type='button' className='btn btn-ghost' disabled={busy} onClick={() => setMode('details')}>Back</button>
                            <button type='button' className='btn btn-primary' disabled={busy} onClick={() => void mutate(() => AdminApi.approveOcularVisit(visit.id, visit.revision), 'Ocular visit approved successfully.')}>{busy ? 'Approving…' : 'Confirm Approval'}</button></div>
                    </div> : mode === 'cancel' ? <div className='ocular-confirmation'>
                        <p>Are you sure you want to cancel the ocular visit for {visit.guest_name} on {calendarDateLabel(visit.visit_date)}?</p>
                        {error && <p role='alert' className='form-error'>{error}</p>}
                        <div className='button-row'><button data-autofocus type='button' className='btn btn-ghost' disabled={busy} onClick={() => setMode('details')}>Keep Visit</button>
                            <button type='button' className='btn btn-danger' disabled={busy} onClick={() => void mutate(() => AdminApi.cancelOcularVisit(visit.id, visit.revision), 'Ocular visit cancelled successfully.', true)}>{busy ? 'Cancelling…' : 'Confirm Cancellation'}</button></div>
                    </div> : mode === 'edit' && draft ? <form onSubmit={reviewEdit}>
                        <p>Update the onsite inspection schedule. The creator and approval status will be preserved.</p>
                        <fieldset disabled={busy}><div className='form-grid'>
                            <label className='field'><span>Guest Name</span><input data-autofocus required maxLength={255} value={draft.guest_name} onChange={event => updateDraft('guest_name', event.target.value)} /></label>
                            <label className='field'><span>Contact Details</span><input required maxLength={255} value={draft.contact_details} onChange={event => updateDraft('contact_details', event.target.value)} /></label>
                            <label className='field'><span>Visit Date</span><input type='date' required min={manilaDate()} value={draft.visit_date} onChange={event => updateDraft('visit_date', event.target.value)} /></label>
                            <label className='field'><span>Inquiry Source</span><select value={draft.inquiry_source} onChange={event => updateDraft('inquiry_source', event.target.value)}><option value=''>Select option</option>{sources.map(source => <option key={source}>{source}</option>)}</select></label>
                            <label className='field'><span>Start Time</span><input type='time' required value={draft.start_time} onChange={event => updateDraft('start_time', event.target.value)} /></label>
                            <label className='field'><span>End Time</span><input type='time' required value={draft.end_time} onChange={event => updateDraft('end_time', event.target.value)} /></label>
                        </div><label className='field'><span>Notes</span><textarea maxLength={4200} value={draft.notes} onChange={event => updateDraft('notes', event.target.value)} /></label>
                        {error && <p role='alert' className='form-error'>{error}</p>}
                        <div className='button-row'><button type='button' className='btn btn-ghost' onClick={() => { setDraft(fieldsFrom(visit)); setError(''); setMode('details'); }}>Back</button><button type='submit' className='btn btn-primary'>Review Changes</button></div></fieldset>
                    </form> : mode === 'confirm-edit' && draft ? <div className='ocular-confirmation'>
                        <p>Change this ocular visit to {calendarDateLabel(draft.visit_date)}, {timeLabel(draft.start_time)}–{timeLabel(draft.end_time)} for {draft.guest_name}?</p>
                        {error && <p role='alert' className='form-error'>{error}</p>}
                        <div className='button-row'><button data-autofocus type='button' className='btn btn-ghost' disabled={busy} onClick={() => setMode('edit')}>Back</button>
                            <button type='button' className='btn btn-primary' disabled={busy} onClick={() => void mutate(() => AdminApi.updateOcularVisit(visit.id, { ...draft, revision: visit.revision }), 'Ocular visit updated successfully.')}>{busy ? 'Saving…' : 'Confirm Changes'}</button></div>
                    </div> : <>
                        <div className='ocular-identity'><span className={`badge ${visit.status === 'approved' ? 'badge-green' : visit.status === 'cancelled' ? 'badge-red' : 'badge-amber'}`}>{statusText[visit.status]}</span>
                            <h3>{visit.guest_name}</h3><p>Onsite inspection before booking · no reservation deposit required.</p></div>
                        {success && <p role='status' className='form-success'>{success}</p>}{error && <p role='alert' className='form-error'>{error}</p>}
                        <div className='ocular-detail-grid'>{details.map(([label, value]) => <div className='ocular-detail-card' key={label}><span>{label}</span><b>{value}</b></div>)}</div>
                        <div className='ocular-notes'><span>Notes</span><p className='preserve-lines'>{visit.notes || 'No notes'}</p></div>
                        <div className='ocular-actions'><button data-autofocus type='button' className='btn btn-primary' disabled={busy || visit.status !== 'pending_review'} onClick={() => { setError(''); setMode('approve'); }}>{visit.status === 'approved' ? 'Approved' : 'Approve'}</button>
                            <button type='button' className='btn btn-secondary' disabled={busy || disabled} onClick={() => { setError(''); setSuccess(''); setDraft(fieldsFrom(visit)); setMode('edit'); }}>Reschedule</button>
                            <button type='button' className='btn btn-danger' disabled={busy || disabled} onClick={() => { setError(''); setMode('cancel'); }}>{visit.status === 'cancelled' ? 'Cancelled' : 'Cancel Visit'}</button>
                            <button type='button' className='btn btn-ghost' disabled={busy} onClick={onClose}>Close</button></div>
                    </>}
        </div>
    </CalendarDialog>;
}
