import { money } from "../../../api";
import { apiBaseUrl } from "../../../services/ReservationApi";
import type { AdminReservation } from "../../../types/admin";
import { DetailPanel } from "./DetailPrimitives";

export default function ReservationPayments({ reservation: r }: { reservation: AdminReservation }) {
    return <DetailPanel title="Payments" copy="Approved payments count toward the deposit. Payment records are managed through the dedicated verification workflow.">
        {r.payments?.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Reference / Method</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Review Note</th></tr></thead>
            <tbody>{r.payments.map(p => <tr key={p.id}><td><b>{p.reference}</b><small>{p.method}</small><a href={`${apiBaseUrl}/api/payments/${p.id}/receipt`}>View receipt</a></td><td>{money(p.amount)}</td>
                <td><span className={`badge ${p.status === "approved" ? "badge-green" : "badge-neutral"}`}>{p.status === "approved" ? "Verified" : p.status}</span></td><td>{p.review_note || "Not recorded"}</td></tr>)}</tbody></table></div>
            : <p className="detail-empty">{r.payments ? "No payments submitted." : "Payment records unavailable."}</p>}
    </DetailPanel>;
}
