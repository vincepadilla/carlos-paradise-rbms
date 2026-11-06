import { useState } from "react";
import { rejectionValidation } from "../../../utils/paymentReview";
import { DetailConfirmation } from "../reservation-details/DetailPrimitives";

export default function PaymentDecisionDialog({ decision, busy, error, onClose, onConfirm }: {
    decision: "approved" | "rejected"; busy: boolean; error: string | null; onClose: () => void; onConfirm: (note: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [validation, setValidation] = useState<string | null>(null);
    function submit(event: React.FormEvent) {
        event.preventDefault();
        const problem = decision === "rejected" ? rejectionValidation(reason) : null;
        setValidation(problem);
        if (!problem) onConfirm(decision === "approved" ? "Deposit transfer and uploaded proof verified by Admin." : reason.trim());
    }
    return <DetailConfirmation title={decision === "approved" ? "Approve this deposit payment?" : "Reject this deposit payment?"} busy={busy} onClose={onClose}>
        <form onSubmit={submit}>
            {decision === "approved" ? <p>Approval marks this payment as Verified and confirms this reservation as an official secured booking. The Admin Calendar, Reservation Details, and the customer’s reservation will reflect the confirmation on their next refresh.</p>
                : <><p>The submitted proof stays in payment history. The customer can submit a new proof while their renewed deposit opportunity is active.</p>
                    <label className="payment-rejection-reason" htmlFor="rejection-reason">Reason for rejection<textarea id="rejection-reason" value={reason} disabled={busy} required minLength={3} maxLength={1000} aria-invalid={Boolean(validation)} aria-describedby={validation ? "rejection-error" : undefined}
                        placeholder="Explain the issue, such as an unreadable receipt, incorrect amount, or invalid reference." onChange={event => { setReason(event.target.value); setValidation(null); }} /></label>
                    {validation && <p id="rejection-error" role="alert" className="detail-error">{validation}</p>}</>}
            {error && <p role="alert" className="detail-error">{error}</p>}
            <div className="button-row"><button className="btn secondary" type="button" disabled={busy} autoFocus onClick={onClose}>Cancel</button>
                <button className={`btn ${decision === "rejected" ? "danger" : ""}`} type="submit" disabled={busy}>{busy ? "Saving…" : decision === "approved" ? "Confirm Approval" : "Confirm Rejection"}</button></div>
        </form>
    </DetailConfirmation>;
}
