import { StaffLink as Link } from "../StaffRouting";
import type { Dispatch, SetStateAction } from "react";

import { dateTime } from "../../../api";
import type { AdminReservation } from "../../../types/admin";
import type { ReservationDetailData, ReservationEdit } from "../../../types/reservationDetails";
import { reservationDisplayStatus } from "../../../utils/reservationDetails";
import StatusBadge from "../StatusBadge";
import { DetailField, DetailPanel } from "./DetailPrimitives";

type Editor = { reservation: AdminReservation; details?: ReservationDetailData; draft: ReservationEdit; editing: boolean; setDraft: Dispatch<SetStateAction<ReservationEdit>> };
const date = (value: string) => new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" });
const time = (value: string) => new Date(value).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

function EditableField({ label, name, draft, setDraft, type = "text", wide = false, optional = false, maxLength = 255, disabled = false }: {
    label: string; name: keyof ReservationEdit; draft: ReservationEdit; setDraft: Editor["setDraft"]; type?: string; wide?: boolean; optional?: boolean; maxLength?: number; disabled?: boolean;
}) {
    return <label className={`field${wide ? " detail-wide" : ""}`}>{label}<input name={name} type={type} value={String(draft[name] ?? "")} required={!optional} maxLength={maxLength} disabled={disabled}
        min={type === "number" ? name === "adults" ? 1 : 0 : undefined} max={type === "number" ? name === "pets" ? 10 : 1000 : undefined}
        onChange={event => setDraft(current => ({ ...current, [name]: type === "number" ? Number(event.target.value) : event.target.value }))} /></label>;
}

export function GuestInformation({ reservation: r, details, draft, editing, setDraft }: Editor) {
    return <DetailPanel title="Guest Information" badge={<span className="badge badge-neutral">Protected information</span>}><div className="data-grid editable-data">
        {editing ? <>
            <EditableField label="Full Name" name="contact_name" draft={draft} setDraft={setDraft} /><EditableField label="Contact Number" name="contact_phone" type="tel" maxLength={30} draft={draft} setDraft={setDraft} />
            <EditableField label="Email Address" name="contact_email" type="email" draft={draft} setDraft={setDraft} /><EditableField label="Address" name="contact_address" optional maxLength={2000} draft={draft} setDraft={setDraft} />
            <EditableField label="Inquiry Source" name="inquiry_source" maxLength={100} draft={draft} setDraft={setDraft} />
        </> : <><DetailField label="Full Name">{r.contact_name}</DetailField><DetailField label="Contact Number">{r.contact_phone}</DetailField>
            <DetailField label="Email Address">{r.contact_email}</DetailField><DetailField label="Address">{details?.contact_address}</DetailField><DetailField label="Inquiry Source">{details?.inquiry_source}</DetailField></>}
    </div></DetailPanel>;
}

export function StayInformation({ reservation: r, details, draft, editing, setDraft }: Editor) {
    const hours = (Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 3_600_000;
    return <><DetailPanel title="Stay Information" copy={editing ? "Schedule changes are checked for conflicts before saving." : "Recorded check-in, check-out, and duration. All times are Asia/Manila."}>
        <div className="data-grid editable-data">{editing ? <>
            <label className="field">Reservation Request Type<select name="type" disabled={details?.capabilities?.can_manage_damages} value={draft.type} onChange={event => setDraft(current => ({ ...current, type: event.target.value as ReservationEdit["type"] }))}><option value="overnight">Overnight Stay</option><option value="day_tour">Day Tour</option></select></label>
            <EditableField label="Check-in Date" name="checkin" type="date" disabled={details?.capabilities?.can_manage_damages} draft={draft} setDraft={setDraft} /><EditableField label="Check-out Date" name="checkout" type="date" draft={draft} setDraft={setDraft} />
            <EditableField label="Check-in Time" name="checkin_time" type="time" disabled={details?.capabilities?.can_manage_damages} draft={draft} setDraft={setDraft} /><EditableField label="Check-out Time" name="checkout_time" type="time" draft={draft} setDraft={setDraft} />
            {details?.capabilities?.can_manage_damages && <p className="detail-note detail-wide">Ongoing stays keep their recorded check-in and visit type. Checkout may be adjusted while the stay remains active.</p>}
        </> : <><DetailField label="Reservation Request Type">{r.type === "day_tour" ? "Day Tour" : "Overnight Stay"}</DetailField>
            <DetailField label="Check-in Date">{date(r.starts_at)}</DetailField><DetailField label="Check-out Date">{date(r.ends_at)}</DetailField><DetailField label="Check-in Time">{time(r.starts_at)}</DetailField>
            <DetailField label="Check-out Time">{time(r.ends_at)}</DetailField><DetailField label="Duration">{Number.isFinite(hours) && hours > 0 ? `${Number(hours.toFixed(2))} hours` : "Not recorded"}</DetailField></>}
        </div></DetailPanel>
        <DetailPanel title="Reservation Information"><div className="data-grid editable-data">{editing ? <>
            <EditableField label="Adults" name="adults" type="number" draft={draft} setDraft={setDraft} /><EditableField label="Children aged 8+" name="children" type="number" draft={draft} setDraft={setDraft} />
            <EditableField label="Pets" name="pets" type="number" draft={draft} setDraft={setDraft} /><label className="field detail-wide">Special Requests<textarea name="notes" maxLength={2000} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} /></label>
        </> : <><DetailField label="Adults">{String(r.adults)}</DetailField><DetailField label="Children aged 8+">{String(r.children)}</DetailField><DetailField label="Pets">{String(r.pets)}</DetailField><DetailField label="Special Requests">{r.notes || "No special requests recorded."}</DetailField></>}
            <DetailField label="Reservation Status"><StatusBadge status={reservationDisplayStatus(r)} /></DetailField>
        </div></DetailPanel></>;
}

export function DepositAccessControls({ reservation: r, details, busy, agreedDeadline, onDeadline, onGrant, onRevoke, onReview }: {
    reservation: AdminReservation; details?: ReservationDetailData; busy: boolean; agreedDeadline: string; onDeadline: (value: string) => void; onGrant: () => void; onRevoke: () => void; onReview: (decision: "approved" | "rejected") => void;
}) {
    const access = r.extension_access;
    const allowed = Boolean(details?.capabilities?.can_grant_extension);
    const requestedDeadline = r.extension_date ? Date.parse(`${r.extension_date.slice(0, 10)}T23:59:59+08:00`) : NaN;
    const canApprove = r.extension_status === "pending" && r.status === "awaiting_deposit" && requestedDeadline > Date.now() && requestedDeadline < Date.parse(r.starts_at);
    return <><DetailPanel title="Deposit Access Controls" copy="Grant only after Admin or Owner agreement with the guest." badge={<span className="badge badge-neutral">Authorized controls</span>} className="access-control-panel">
        <div className="access-control-grid"><label className="extension-deadline" htmlFor="agreed-extension"><span>Agreed Extension Deadline</span>
            <input id="agreed-extension" type="date" disabled={busy || !allowed} value={agreedDeadline} onChange={event => onDeadline(event.target.value)} /><small>Actual deadline changes only after request approval.</small></label>
            <div><span>Deadline Extension Request Access</span><b>{access?.enabled ? "Granted" : access?.consumed_at ? "Consumed" : access?.revoked_at ? "Revoked" : "Not granted"}</b>
                <div className="button-row"><button className="btn" disabled={busy || !allowed || !agreedDeadline} onClick={onGrant}>Grant Access</button><button className="btn secondary" disabled={busy || !allowed || !access?.enabled || Boolean(access.consumed_at)} onClick={onRevoke}>Revoke</button></div></div>
            <div><span>Partial Deposit Payments</span><b>Full deposit required</b><Link className="btn secondary" to={`/admin/reservations/${r.id}/payment-review`}>Manage in Deposit Review</Link></div>
        </div><p className="detail-note"><b>Current Deposit Deadline · </b>{r.deadline ? dateTime(r.deadline) : "Not started"}</p>
        {!allowed && <p className="detail-note">Extension access requires an active unpaid deposit opportunity without a pending extension request. Partial deposits are not supported by the current payment policy.</p>}
    </DetailPanel>
    {r.extension_status && <DetailPanel title="Deposit Deadline Extension Request" copy="The actual payment deadline changes only after approval." badge={<span className="badge badge-neutral">{r.extension_status}</span>}>
        <div className="data-grid"><DetailField label="Current Actual Deadline">{r.deadline ? dateTime(r.deadline) : "Not started"}</DetailField>
            <DetailField label="Requested Payment Date">{r.extension_date ? date(r.extension_date.slice(0, 10) + "T12:00:00+08:00") : "No request recorded"}</DetailField><DetailField label="Reason">{r.extension_reason}</DetailField><DetailField label="Optional Message">{r.extension_message}</DetailField></div>
        {r.extension_status === "pending" && <div className="button-row extension-review-actions"><button className="btn" disabled={busy || !canApprove} onClick={() => onReview("approved")}>Approve Extension</button><button className="btn secondary" disabled={busy} onClick={() => onReview("rejected")}>Reject Extension</button></div>}
    </DetailPanel>}</>;
}
