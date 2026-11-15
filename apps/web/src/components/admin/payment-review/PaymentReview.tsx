import { StaffLink as Link } from "../StaffRouting";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { dateTime, money } from "../../../api";
import { AdminApi } from "../../../services/AdminApi";
import { ReservationApiError } from "../../../services/ReservationApi";
import type { PaymentReviewData } from "../../../types/paymentReview";
import { isReviewablePayment, paymentCents, paymentReviewLabel } from "../../../utils/paymentReview";
import { recordedMoney } from "../../../utils/reservationDetails";
import { useAdminSession } from "../../auth/RequireAdmin";
import AdminPageHeader from "../AdminPageHeader";
import StatusBadge from "../StatusBadge";
import { DetailField, DetailPanel } from "../reservation-details/DetailPrimitives";
import PaymentDecisionDialog from "./PaymentDecisionDialog";
import ReceiptPreview from "./ReceiptPreview";
import StaffEditDialog, { type StaffEditKind } from "./StaffEditDialogs";
import CashPaymentDialog from "./CashPaymentDialog";
import "../reservation-details/reservation-details.css";
import "./payment-review.css";

export default function PaymentReview({ initialData }: { initialData: PaymentReviewData }) {
    const [data, setData] = useState(initialData);
    const [params, setParams] = useSearchParams();
    const [decision, setDecision] = useState<"approved" | "rejected" | null>(null);
    const [busy, setBusy] = useState(false);
    const [receiptReady, setReceiptReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshRequired, setRefreshRequired] = useState(false);
    const [editKind, setEditKind] = useState<StaffEditKind | null>(null);
    const [cashOpen, setCashOpen] = useState(false);
    const { revalidate } = useAdminSession();
    const r = data.reservation;
    const payments = [...(r.payments ?? [])].sort((a, b) => b.id - a.id);
    const selectedId = params.get("payment");
    const p = selectedId ? payments.find(payment => String(payment.id) === selectedId) : payments.find(payment => payment.status === "submitted") ?? payments[0];
    const totalSubmittedCents = payments.reduce((total, payment) => total + (paymentCents(payment.amount) ?? 0), 0);
    const verifiedCents = payments.filter(payment => payment.status === "approved").reduce((total, payment) => total + (paymentCents(payment.amount) ?? 0), 0);
    const selectedCents = p?.status === "submitted" ? paymentCents(p.amount) : null;
    const requiredCents = paymentCents(r.deposit);
    const prospectiveCents = selectedCents === null ? verifiedCents : verifiedCents + selectedCents;
    const differenceCents = requiredCents === null || selectedCents === null ? null : prospectiveCents - requiredCents;
    const reviewable = Boolean(p && isReviewablePayment(r, p) && !refreshRequired);
    const canApprove = reviewable && differenceCents !== null && differenceCents >= 0 && receiptReady && r.total !== null;

    async function review(note: string) {
        if (!p || !decision || busy || !reviewable || (decision === "approved" && !canApprove)) return;
        setBusy(true); setError(null); setNotice(null);
        let saved = false;
        try {
            await AdminApi.reviewPayment(r.id, p.id, decision, note);
            saved = true;
            const updated = await AdminApi.paymentReview(String(r.id), new AbortController().signal);
            setData(updated); setDecision(null);
            setNotice(decision === "approved" ? "Payment verified. This reservation is now confirmed and secured." : "Payment rejected. The reason and original proof remain in payment history. Check the updated reservation status and deadline below.");
        } catch (cause) {
            if (cause instanceof ReservationApiError && [401, 403].includes(cause.status)) revalidate();
            setError(saved ? "The decision was saved, but refreshed details could not be loaded. Refresh this page before reviewing another payment." : cause instanceof Error ? cause.message : "Unable to review this payment.");
            if (saved) { setRefreshRequired(true); setDecision(null); }
        } finally { setBusy(false); }
    }

    return <div className="admin-payment-review">
        <Link className="back-link" to="/admin/reservations?tab=deposit-review">← Back to Deposit Review</Link>
        <AdminPageHeader eyebrow="Carlos Paradise Payment" title="Deposit Verification" copy="Review the submitted payment proof before confirming this reservation."
            action={<Link className="btn secondary" to={`/admin/reservations/${r.id}`}>View Reservation Details</Link>} />
        <p className="payment-reservation-reference">Reservation ID · <b>{r.reference}</b></p>
        {notice && <p className="payment-success" role="status">{notice}</p>}
        {error && !decision && <p className="payment-error" role="alert">{error}</p>}
        <div className="payment-review-layout"><div className="payment-review-main">
            <DetailPanel title="Reservation Information" badge={<div className="panel-actions"><StatusBadge status={r.status} />{r.staff_editable && <button className="btn compact" disabled={busy || refreshRequired} onClick={() => setEditKind("reservation")}>Edit Reservation</button>}</div>}><div className="data-grid">
                <DetailField label="Reservation ID">{r.reference}</DetailField><DetailField label="Guest Name">{r.contact_name}</DetailField>
                <DetailField label="Email">{r.contact_email}</DetailField><DetailField label="Contact Number">{r.contact_phone}</DetailField>
                <DetailField label="Check-in">{dateTime(r.starts_at)}</DetailField><DetailField label="Check-out">{dateTime(r.ends_at)}</DetailField>
                <DetailField label="Visit Type">{r.type === "day_tour" ? "Day Tour" : "Overnight Stay"}</DetailField><DetailField label="Number of Guests">{`${r.adults} adults · ${r.children} children · ${r.pets} pets`}</DetailField>
                <DetailField label="Required Deposit">{money(r.deposit)}</DetailField><DetailField label="Agreed Total">{recordedMoney(r.total)}</DetailField>
                <DetailField label="Current Reservation Status"><StatusBadge status={r.status} /></DetailField><DetailField label="Deposit Deadline">{r.deadline ? dateTime(r.deadline) : "Not started"}</DetailField>
                <DetailField label="Additional Services">{`${r.bonfire_qty ?? 0} bonfire · ${r.charcoal_qty ?? 0} charcoal · ${r.liquor_qty ?? 0} liquor`}</DetailField><DetailField label="Special Requests" wide>{r.notes || "No special requests recorded."}</DetailField>
            </div></DetailPanel>
            <DetailPanel title="Submitted Payment" badge={<div className="panel-actions">{p && <span className={`badge ${p.status === "approved" ? "badge-green" : "badge-neutral"}`}>{paymentReviewLabel(p.status)}</span>}{r.staff_editable && <button className="btn compact" disabled={busy || refreshRequired} onClick={() => setCashOpen(true)}>Record Cash Payment</button>}{r.staff_editable && p?.status === "submitted" && p.staff_recorded && <button className="btn compact" disabled={busy || refreshRequired} onClick={() => setEditKind("payment")}>Edit Payment Details</button>}</div>}>
                {(payments.length > 1 || (!p && payments.length > 0)) && <label className="payment-selection">Payment submission<select value={p?.id ?? ""} disabled={busy} onChange={event => { setReceiptReady(false); setParams({ payment: event.target.value }, { replace: true }); setError(null); setNotice(null); }}>
                    {!p && <option value="">Select a payment</option>}{payments.map(payment => <option key={payment.id} value={payment.id}>{payment.reference} · {paymentReviewLabel(payment.status)}</option>)}
                </select></label>}
                {p ? <div className="data-grid"><DetailField label="Amount Paid">{money(p.amount)}</DetailField><DetailField label={p.method === "Cash" ? "Cash Receipt Number" : "Payment Reference Number"}>{p.reference}</DetailField>
                    <DetailField label={p.method === "Cash" ? "Date Received" : "Date of Payment"}>{p.payment_date ? new Date(p.payment_date.slice(0, 10) + "T12:00:00+08:00").toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long" }) : "Not recorded"}</DetailField>
                    <DetailField label="Payment Method">{p.method}</DetailField><DetailField label={p.method === "Cash" ? "Date/Time Received" : "Submission Date/Time"}>{p.submitted_at ? dateTime(p.submitted_at) : "Not recorded"}</DetailField>
                    <DetailField label="Current Payment Status">{paymentReviewLabel(p.status)}</DetailField>
                    {p.reviewed_at && <DetailField label="Reviewed">{dateTime(p.reviewed_at)}{p.reviewed_by != null && ` · Admin #${p.reviewed_by}`}</DetailField>}
                    {p.staff_notes && <DetailField label="Staff Notes" wide>{p.staff_notes}</DetailField>}
                    {p.review_note && <DetailField label={p.status === "rejected" ? "Reason for rejection" : "Review Note"} wide>{p.review_note}</DetailField>}
                </div> : <p className="payment-empty">{selectedId ? "This payment does not belong to this reservation. Select a recorded submission." : "No payment submitted for this reservation."}</p>}
            </DetailPanel>
            {p ? <ReceiptPreview key={`${p.id}-${p.revision ?? 0}`} reservationId={r.id} paymentId={p.id} receipt={data.receipts[p.id]} cash={p.method === "Cash"} onReady={setReceiptReady} />
                : <DetailPanel title="Payment Receipt / Proof"><p className="payment-empty">No payment receipt submitted.</p></DetailPanel>}
            <DetailPanel title="Payment History" copy="Original submissions and review decisions are retained."><div className="payment-history-list">
                {payments.length ? payments.map(payment => <div key={payment.id}><i aria-hidden="true" /><span><b>{payment.reference} · {money(payment.amount)} · {paymentReviewLabel(payment.status)}</b>
                    <small>{payment.submitted_at ? dateTime(payment.submitted_at) : "Submission time not recorded"}{payment.reviewed_at && ` · Reviewed ${dateTime(payment.reviewed_at)}`}</small>{payment.review_note && <span>{payment.review_note}</span>}</span></div>) : <p>No payment history.</p>}
            </div></DetailPanel>
        </div><aside className="payment-review-side"><DetailPanel title="Payment Verification" badge={<div className="panel-actions"><span className={`badge ${p?.status === "approved" ? "badge-green" : "badge-neutral"}`}>{p ? paymentReviewLabel(p.status) : "No submission"}</span>{r.staff_editable && <button className="btn compact" disabled={busy || refreshRequired} onClick={() => setEditKind("terms")}>Edit Deposit Terms</button>}</div>}>
            <dl className="verification-summary"><div><dt>Minimum Required Deposit</dt><dd>{money(r.deposit)}</dd></div><div><dt>Total Submitted</dt><dd>{money(totalSubmittedCents / 100)}</dd></div>
                <div><dt>Already Verified</dt><dd>{money(verifiedCents / 100)}</dd></div><div><dt>Selected Submission</dt><dd>{p ? money(p.amount) : "Unavailable"}</dd></div>
                <div><dt>Prospective Verified Total</dt><dd>{p?.status === "submitted" ? money(prospectiveCents / 100) : "Unavailable"}</dd></div>
                <div className={differenceCents === null ? "" : differenceCents < 0 ? "amount-mismatch" : differenceCents > 0 ? "amount-excess" : "amount-match"}><dt>{differenceCents !== null && differenceCents < 0 ? "Remaining Deposit" : "Excess Payment"}</dt><dd>{differenceCents === null ? "Unavailable" : money(Math.abs(differenceCents) / 100)}</dd></div></dl>
            {p && p.status === "submitted" && differenceCents !== null && differenceCents < 0 && <p className="verification-warning" role="alert">The prospective verified total is below the minimum required deposit. Remaining deposit: {money(Math.abs(differenceCents) / 100)}. Approval is blocked.</p>}
            {p && p.status === "submitted" && differenceCents === 0 && <p className="verification-met">Deposit requirement met.</p>}
            {p && p.status === "submitted" && differenceCents !== null && differenceCents > 0 && <p className="verification-neutral">Deposit requirement met. Excess payment: {money(differenceCents / 100)}.</p>}
            {r.total === null && <p className="verification-warning">Agree the reservation total before approving a deposit.</p>}
            {r.partial_payment_authorized && <p className="verification-neutral"><b>Authorized partial payments:</b> {r.partial_payment_terms}</p>}
            <div className="payment-decision-actions"><button className="btn" disabled={busy || !canApprove} onClick={() => { setError(null); setDecision("approved"); }}>Approve Payment</button>
                <button className="btn danger" disabled={busy || !reviewable} onClick={() => { setError(null); setDecision("rejected"); }}>Reject Payment</button>
                <p>{reviewable ? "Verify the actual transfer before approving. Approval requires a loaded receipt and the minimum required deposit." : "This submission is not awaiting a reviewable decision."}</p>
            </div>
        </DetailPanel></aside></div>
        {decision && <PaymentDecisionDialog decision={decision} busy={busy} error={error} onClose={() => { setDecision(null); setError(null); }} onConfirm={note => void review(note)} />}
        {editKind && <StaffEditDialog kind={editKind} data={data} payment={p} onClose={() => { setEditKind(null); setError(null); }} onSaved={(updated, message) => { if (editKind === "payment") setReceiptReady(false); setData(updated); setEditKind(null); setNotice(message); setError(null); }} />}
        {cashOpen && <CashPaymentDialog data={data} onClose={() => setCashOpen(false)} onSaved={(updated, message) => { setData(updated); setCashOpen(false); setNotice(message); setError(null); setReceiptReady(false); }} />}
    </div>;
}
