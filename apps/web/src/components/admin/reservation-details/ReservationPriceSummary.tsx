import type { Dispatch, SetStateAction } from "react";
import type { AdminReservation } from "../../../types/admin";
import type { ReservationDetailData, ReservationEdit } from "../../../types/reservationDetails";
import { approvedPayments, priceFields, priceLines, pricePreview, recordedMoney } from "../../../utils/reservationDetails";
import { Icon } from "../../reservations/ReservationUI";
import { DetailPanel, PesoInput } from "./DetailPrimitives";

const discountLabel = (type?: string) => ({ none: "No Discount", percentage: "Percentage", fixed: "Fixed Amount" })[type ?? ""] ?? "Not recorded";

export default function ReservationPriceSummary({ reservation: r, details, mode, draft, setDraft, total, error, onTotal, busy }: {
    reservation: AdminReservation; details?: ReservationDetailData; mode: "booking" | "total" | null; draft: ReservationEdit; setDraft: Dispatch<SetStateAction<ReservationEdit>>;
    total: string; error: string | null; onTotal: (value: string) => void; busy: boolean;
}) {
    const editing = mode === "booking";
    const lines = priceLines(details, r.type);
    const costLines = editing ? priceFields.map(({ key, label }) => ({ label, value: draft.pricing[key] || null })) : lines;
    const paid = approvedPayments(r);
    const preview = pricePreview(draft);
    const discount = details?.pricing.discount;
    const paymentStatus = paid !== null && paid >= Number(r.deposit) ? "Deposit paid" : r.payments?.some(p => p.status === "submitted") ? "Pending review" : paid ? "Partially paid" : "Unpaid";
    const displayedTotal = editing ? preview.errors.length ? null : preview.total : r.total;
    const security = details?.pricing.security_deposit ?? details?.configured_security_deposit;
    return <aside className="detail-side" aria-label="Reservation pricing">
        <DetailPanel title="Editable Price Summary" copy="Update recorded charges and discounts. Final prices are checked before saving." badge={<span className={`badge ${mode ? "badge-amber" : "badge-neutral"}`}>{mode ? "Editing" : "View only"}</span>} className="editable-price-card">
            <div className="price-editor-grid">{editing ? priceFields.map(({ key, label }) => <PesoInput key={key} label={label} value={draft.pricing[key]} onChange={busy ? undefined : value => setDraft(current => ({ ...current, pricing: { ...current.pricing, [key]: value } }))} />)
                : lines.map(line => <PesoInput key={line.label} label={line.label} value={line.value} />)}
                {r.type === "day_tour" && mode !== "booking" && <div className="detail-wide"><PesoInput label="Agreed Day Tour Total" value={mode === "total" ? total : r.total} onChange={mode === "total" && !busy ? onTotal : undefined} error={mode === "total" ? error : null} /></div>}
            </div><p className="detail-note">{editing ? "Enter every recorded charge, including zero where no charge applies. The preview is not saved until Confirm Update." : "Prices reflect the recorded booking agreement. Unrecorded charges are not treated as zero."}</p>
            <div className="discount-editor"><div className="discount-editor-head"><div><h3>Discount Details</h3><p>Discounts apply to the base reservation price.</p></div><span className="badge badge-neutral">{editing ? "Editing" : "View only"}</span></div>
                <div className="discount-editor-grid"><div className="discount-readout"><span>Base Reservation Price</span><b>{recordedMoney(editing ? draft.pricing.base || null : lines[0].value)}</b></div>
                    {editing ? <>
                        <label>Discount Type<select name="discount.type" disabled={busy} value={draft.discount.type} onChange={event => setDraft(current => ({ ...current, discount: { ...current.discount, type: event.target.value as ReservationEdit["discount"]["type"], value: event.target.value === "none" ? "0" : current.discount.value } }))}><option value="none">No Discount</option><option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option></select></label>
                        <label>Discount Value<input name="discount.value" inputMode="decimal" disabled={busy || draft.discount.type === "none"} value={draft.discount.value} onChange={event => setDraft(current => ({ ...current, discount: { ...current.discount, value: event.target.value } }))} /></label>
                        <div className="discount-readout"><span>Discount Amount</span><b>{recordedMoney(preview.discount)}</b></div>
                    </> : <><div className="discount-readout"><span>Discount Type</span><b>{discountLabel(discount?.type)}</b></div><div className="discount-readout"><span>Discount Value</span><b>{discount ? discount.type === "percentage" ? `${discount.value}%` : recordedMoney(discount.value) : "Not recorded"}</b></div><div className="discount-readout"><span>Discount Amount</span><b>{recordedMoney(discount?.amount)}</b></div></>}
                    <div className="discount-readout discount-final"><span>Final Reservation Price{editing ? " (preview)" : ""}</span><strong>{recordedMoney(displayedTotal)}</strong></div>
                    <label className="discount-justification">Discount Justification{editing && draft.discount.type !== "none" && <i>Required</i>}<textarea name="discount.justification" disabled={!editing || busy} maxLength={2000} value={editing ? draft.discount.justification ?? "" : discount?.justification ?? "Not recorded"}
                        onChange={event => setDraft(current => ({ ...current, discount: { ...current.discount, justification: event.target.value } }))} /></label>
                </div>{discount?.applied_at && !editing && <div className="discount-audit"><span><small>Applied by</small><b>Staff #{discount.applied_by}</b></span><span><small>Applied at</small><b>{new Date(discount.applied_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</b></span></div>}
            </div>
        </DetailPanel>
        <DetailPanel title="Reservation Cost Summary" className="payment-record cost-record">
            {costLines.map(line => <div key={line.label}><span>{line.label}</span><b>{recordedMoney(line.value)}</b></div>)}
            <div><span>Discount Type</span><b>{discountLabel(editing ? draft.discount.type : discount?.type)}</b></div><div><span>Discount Amount</span><b>{recordedMoney(editing ? preview.discount : discount?.amount)}</b></div>
            <div className="updated-total"><span>Final Reservation Price{editing ? " (preview)" : ""}</span><strong>{recordedMoney(displayedTotal)}</strong></div>
            <div><span>Deposit Required</span><b>{recordedMoney(r.deposit)}</b></div><div><span>Deposit Paid</span><b>{recordedMoney(paid)}</b></div>
            <div><span>Status</span><span className={`badge ${paymentStatus === "Deposit paid" ? "badge-green" : "badge-neutral"}`}>{paid === null ? "Unavailable" : paymentStatus}</span></div>
        </DetailPanel>
        <section className="security-record" aria-label="Refundable Security Deposit"><Icon name="shield" /><span>Refundable Security Deposit</span><strong>{recordedMoney(security)}</strong>
            <p>Collected during check-in and refundable after inspection. Not included in the reservation total.{details?.pricing.security_deposit == null && security != null ? " Current configured policy; no amount was recorded in this booking's snapshot." : ""}</p></section>
    </aside>;
}
