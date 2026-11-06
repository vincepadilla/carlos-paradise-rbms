import { useRef, useState, type FormEvent } from "react";
import type { AvailabilityBlock } from "../../../types/admin";
import { AdminApi } from "../../../services/AdminApi";
import { ReservationApiError } from "../../../services/ReservationApi";
import { blockDescription, blockReason, calendarDateLabel, manilaDate } from "../../../utils/adminCalendar";
import { useAdminSession } from "../../auth/RequireAdmin";
import CalendarDialog from "./CalendarDialog";

export default function BlockDateDialog({ date, block, details = false, onClose, onSaved }: {
    date: string; block?: AvailabilityBlock; details?: boolean; onClose: () => void; onSaved: (date?: string) => void;
}) {
    const existing = blockDescription(block?.reason ?? "");
    const [editing, setEditing] = useState(!details);
    const [removing, setRemoving] = useState(false);
    const [selectedDate, setSelectedDate] = useState(date);
    const [reason, setReason] = useState(existing.reason);
    const [notes, setNotes] = useState(existing.notes);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const { clear, revalidate } = useAdminSession();

    async function mutate(release = false) {
        if (submitting.current) return;
        submitting.current = true; setBusy(true); setError("");
        try {
            if (release && block) await AdminApi.releaseBlock(block.id);
            else if (block) await AdminApi.updateBlock(block.id, blockReason(reason, notes));
            else await AdminApi.createBlock(selectedDate, blockReason(reason, notes));
            onSaved(!block && !release ? selectedDate : undefined);
        } catch (cause) {
            if (cause instanceof ReservationApiError && cause.status === 401) clear();
            if (cause instanceof ReservationApiError && cause.status === 403) revalidate();
            setError(cause instanceof ReservationApiError && cause.status === 404 ? "This date block is no longer available. Close this dialog and refresh the calendar."
                : cause instanceof Error ? cause.message : "The block could not be saved. Please try again.");
        } finally { submitting.current = false; setBusy(false); }
    }
    function submit(event: FormEvent) { event.preventDefault(); void mutate(); }
    const errorMessage = error && <p role="alert" className="form-error">{error}</p>;
    return <CalendarDialog title={removing ? "Remove Block?" : editing ? block ? "Edit Block" : "Block Villa Date" : "Blocked Date Details"}
        headerBadge={!editing && !removing ? <span className="badge badge-red">Blocked</span> : undefined}
        className="block-modal" busy={busy} onClose={onClose}>
        {(!editing || removing) && errorMessage}
        {removing ? <><p>Are you sure you want to make this blocked period available for reservation again?</p>
            <div className="button-row"><button type="button" className="btn btn-danger" disabled={busy} onClick={() => void mutate(true)}>{busy ? "Removing…" : "Remove Block"}</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRemoving(false)}>Cancel</button></div></>
            : editing ? <form onSubmit={submit} aria-busy={busy}>
                <p>Prevent reservation requests for a date when the private villa is unavailable.</p>
                <fieldset disabled={busy}>
                    <label className="field"><span>Date</span><input type="date" required min={block ? undefined : manilaDate()} value={selectedDate} readOnly={!!block} onChange={event => setSelectedDate(event.target.value)} /></label>
                    {block && <p className="form-hint">This block’s dates are preserved. Remove it and create another block to change the period.</p>}
                    <label className="field"><span>Reason</span><input required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Maintenance, private event, or villa unavailable" /></label>
                    <label className="field"><span>Optional Notes</span><textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Additional explanation" /></label>
                    <p className="form-hint">Reason and notes are saved together.</p>
                    {errorMessage}
                    <div className="button-row"><button className="btn btn-danger" type="submit">{busy ? "Saving…" : block ? "Save Block" : "Block Date"}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
                </fieldset>
            </form> : block && <><div className="block-details">
                <span>From<b>{calendarDateLabel(block.starts_on)}</b></span><span>Until (exclusive)<b>{calendarDateLabel(block.ends_on)}</b></span>
                <span>Reason<b>{existing.reason}</b></span><span>Notes<b className="preserve-lines">{existing.notes || "No additional notes."}</b></span>
            </div><div className="button-row"><button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit Block</button>
                <button type="button" className="btn btn-danger" onClick={() => setRemoving(true)}>Remove Block</button><button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></div></>}
    </CalendarDialog>;
}
