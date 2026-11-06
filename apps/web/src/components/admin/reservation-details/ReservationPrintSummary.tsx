import { dateTime, money } from "../../../api";
import type { ReservationDetailResponse } from "../../../types/reservationDetails";
import { priceLines, recordedMoney, reservationDisplayStatus } from "../../../utils/reservationDetails";
import StatusBadge from "../StatusBadge";

export default function ReservationPrintSummary({ data, type }: { data: ReservationDetailResponse; type: "checkin" | "checkout" }) {
    const r = data.reservation, d = data.details;
    return <article className="reservation-print-summary" aria-label="Printable Reservation Summary">
        <header><span>Carlos Paradise Resort</span><h1>{type === "checkout" ? "Check-out Summary" : "Check-in Summary"}</h1><p>{r.reference}</p></header>
        <h2>Guest & Stay</h2><dl><dt>Guest</dt><dd>{r.contact_name}</dd><dt>Contact</dt><dd>{r.contact_email} · {r.contact_phone}</dd>
            <dt>Address</dt><dd>{d?.contact_address || "Not recorded"}</dd><dt>Stay</dt><dd>{dateTime(r.starts_at)} – {dateTime(r.ends_at)} (Asia/Manila)</dd>
            <dt>Type / Guests</dt><dd>{r.type === "day_tour" ? "Day Tour" : "Overnight"} · {r.adults} adults · {r.children} children · {r.pets} pets</dd>
            <dt>Status</dt><dd><StatusBadge status={reservationDisplayStatus(r)} /></dd><dt>Special requests</dt><dd>{r.notes || "None recorded"}</dd>
            <dt>Agreed total</dt><dd>{recordedMoney(r.total)}</dd><dt>Required deposit</dt><dd>{money(r.deposit)}</dd><dt>Deposit deadline</dt><dd>{r.deadline ? dateTime(r.deadline) : "Not started"}</dd>
            <dt>Security deposit</dt><dd>{recordedMoney(d?.pricing.security_deposit ?? d?.configured_security_deposit)} (refundable and separate)</dd></dl>
        <h2>Recorded Charges</h2><dl>{priceLines(d, r.type).map(line => <div className="print-price-line" key={line.label}><dt>{line.label}</dt><dd>{recordedMoney(line.value)}</dd></div>)}
            <dt>Discount Amount</dt><dd>{recordedMoney(d?.pricing.discount?.amount)}</dd></dl>
        <h2>Payments</h2>{r.payments?.length ? r.payments.map(p => <p key={p.id}>{p.reference} · {p.method} · {money(p.amount)} · {p.status === "approved" ? "Verified" : p.status}{p.review_note && ` · ${p.review_note}`}</p>) : <p>No payments submitted.</p>}
        {type === "checkout" && <><h2>Damages & Final Charges</h2>{d?.damages?.map(record => <p key={record.id}>{record.description} · {record.item_area} · {money(record.amount)}{record.notes && ` · ${record.notes}`}</p>)}
            <dl><dt>Damage charges</dt><dd>{recordedMoney(d?.totals?.damage_total)}</dd><dt>Verified payments</dt><dd>{recordedMoney(d?.totals?.paid)}</dd><dt>Final amount due</dt><dd>{recordedMoney(d?.totals?.amount_due)}</dd></dl></>}
        <p>Amounts are based on recorded booking charges and verified payments. This summary is not a payment receipt.</p>
    </article>;
}
