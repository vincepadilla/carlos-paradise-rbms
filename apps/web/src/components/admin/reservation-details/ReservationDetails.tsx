import { useState } from "react";
import { Link } from "react-router";
import type { ReservationDetailResponse } from "../../../types/reservationDetails";
import { canAgreeTotal } from "../../../utils/reservationDetails";
import useReservationEditor, { type ReservationAction } from "../../../hooks/useReservationEditor";
import AdminPageHeader from "../AdminPageHeader";
import { DetailConfirmation } from "./DetailPrimitives";
import { DepositAccessControls, GuestInformation, StayInformation } from "./ReservationInformation";
import ReservationPriceSummary from "./ReservationPriceSummary";
import ReservationDamages from "./ReservationDamages";
import ReservationPayments from "./ReservationPayments";
import ReservationPrintSummary from "./ReservationPrintSummary";
import UnsavedReservationGuard from "./UnsavedReservationGuard";
import "./reservation-details.css";

const actions: Record<ReservationAction, { title: string; copy: string; confirm: string }> = {
    update: { title: "Update Reservation?", copy: "Reservation information, pricing, and the Calendar schedule may change. All changes, including damage records, will be saved together and recorded for audit.", confirm: "Confirm Update" },
    complete: { title: "Confirm Completed Staycation?", copy: "Verify the reservation, payments, damages, and final charges before completing checkout. Completion makes this booking and its damage records read only. It does not record a new payment or refund.", confirm: "Confirm Completion" },
    total: { title: "Save Reservation Changes?", copy: "Save the agreed day-tour total through the existing booking workflow?", confirm: "Confirm" },
    grant: { title: "Grant Extension Request Access?", copy: "Authorize this guest to request a payment date up to the agreed deadline. The actual deposit deadline changes only after the request is approved.", confirm: "Confirm Grant" },
    revoke: { title: "Revoke Extension Request Access?", copy: "Revoke this unconsumed permission. The current actual deposit deadline will remain unchanged.", confirm: "Confirm Revoke" },
    approved: { title: "Approve Deadline Extension?", copy: "Approve the guest's requested date and update the actual deposit deadline?", confirm: "Confirm" },
    rejected: { title: "Reject Deadline Extension?", copy: "Reject this extension request and keep the actual deposit deadline unchanged?", confirm: "Confirm" },
};

export default function ReservationDetails({ initialData }: { initialData: ReservationDetailResponse }) {
    const editor = useReservationEditor(initialData);
    const { data, draft, setDraft, editing, busy, confirmation, error, refreshRequired } = editor;
    const r = data.reservation, d = data.details;
    const [printType, setPrintType] = useState<"checkin" | "checkout">("checkin");
    const fullEdit = editing === "booking";
    const eligible = Boolean(d?.capabilities?.can_edit);
    const canEdit = eligible || canAgreeTotal(r);
    function confirm(action: ReservationAction) { editor.setError(null); editor.setConfirmation(action); }
    const informationProps = { reservation: r, details: d, draft, editing: fullEdit, setDraft };
    return <div className="admin-reservation-detail">
        <Link className="back-link" to="/admin/reservations">← Back to Reservations</Link>
        <AdminPageHeader eyebrow="Carlos Paradise Reservation" title="Reservation Details" copy={`Reservation ID · ${r.reference}`} action={
            <div className="button-row">{editing ? <><button className="btn" onClick={editor.confirmSave} disabled={busy || refreshRequired}>{busy ? "Saving…" : "Save Changes"}</button><button className="btn secondary" disabled={busy} onClick={editor.cancel}>Cancel</button></> : <>
                <div className="print-summary-control"><select aria-label="Print summary type" disabled={busy || refreshRequired} value={printType} onChange={event => setPrintType(event.target.value as typeof printType)}><option value="checkin">Check-in Summary</option><option value="checkout">Check-out Summary</option></select><button className="btn secondary" disabled={busy || refreshRequired} onClick={() => window.print()}>Print Summary</button></div>
                <button className="btn secondary" disabled={busy || refreshRequired || !canEdit} title={canEdit ? "Edit the booking's recorded information" : "Only active/future confirmed bookings with a verified deposit are editable"}
                    onClick={() => { editor.setEditing(eligible ? "booking" : "total"); editor.setNotice(null); editor.setError(null); }}>Edit Reservation</button>
                <button className="btn" disabled={busy || refreshRequired || !d?.capabilities?.can_complete} onClick={() => confirm("complete")}>Mark as Completed</button>
            </>}</div>
        } />
        {editor.notice && <p className="detail-success" role="status">{editor.notice}</p>}
        {error && !confirmation && <div className="detail-error" role="alert"><p>{error}</p>{refreshRequired && <button className="btn secondary" disabled={busy} onClick={() => void editor.reload()}>Reload latest details</button>}</div>}
        <div className="admin-detail-grid"><div className="detail-main">
            <GuestInformation {...informationProps} />
            <DepositAccessControls reservation={r} details={d} busy={busy || Boolean(editing) || refreshRequired} agreedDeadline={editor.agreedDeadline} onDeadline={editor.setAgreedDeadline} onGrant={() => confirm("grant")} onRevoke={() => confirm("revoke")} onReview={confirm} />
            <StayInformation {...informationProps} />
            <ReservationDamages details={d} total={r.total} draft={draft} setDraft={setDraft} editing={fullEdit} busy={busy} />
            <ReservationPayments reservation={r} />
        </div><ReservationPriceSummary reservation={r} details={d} mode={editing} draft={draft} setDraft={setDraft} total={editor.total} onTotal={editor.setTotal} error={error} busy={busy} /></div>
        {confirmation && <DetailConfirmation title={actions[confirmation].title} busy={busy} onClose={() => { editor.setConfirmation(null); editor.setError(null); }}>
            <p>{actions[confirmation].copy}</p>{confirmation === "grant" && <p><b>Agreed payment date: {editor.agreedDeadline}</b></p>}
            {error && <p className="detail-error" role="alert">{error}</p>}
            <div className="button-row"><button className="btn secondary" disabled={busy} autoFocus onClick={() => { editor.setConfirmation(null); editor.setError(null); }}>Cancel</button>
                <button className="btn" disabled={busy} onClick={() => void editor.persist(confirmation)}>{busy ? "Saving…" : actions[confirmation].confirm}</button></div>
        </DetailConfirmation>}
        <UnsavedReservationGuard dirty={Boolean(editor.dirty)} busy={busy} />
        <ReservationPrintSummary data={data} type={printType} />
    </div>;
}
