import { useCallback } from "react";
import { Link, useSearchParams } from "react-router";
import { money } from "../../../api";
import { AdminApi } from "../../../services/AdminApi";
import AdminPagination from "../AdminPagination";
import AdminResource from "../AdminResource";

export default function DepositReviewList() {
    const [params, setParams] = useSearchParams();
    const requestedPage = Number(params.get("page") ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const load = useCallback((signal: AbortSignal) => AdminApi.paymentReviews(page, signal), [page]);
    return <AdminResource load={load}>{({ data: deposits, total, current_page, last_page }) => <section aria-label="Deposit Review">
        <h2 className="deposit-list-heading">Deposit Review <small>{total} awaiting review</small></h2>
        {deposits.length ? <div className="admin-table-scroll"><table className="admin-table admin-reservation-table"><thead><tr><th>Reservation</th><th>Guest</th><th>Payment Reference</th><th>Submitted Amount</th><th className="admin-reservation-actions">Action</th></tr></thead>
            <tbody>{deposits.map(({ reservation: r, payment: p }) => <tr key={p.id}><td><Link to={`/admin/reservations/${r.id}`}>{r.reference}</Link></td><td>{r.contact_name}</td><td>{p.reference}<br />{p.method}</td><td>{money(p.amount)}</td>
                <td className="admin-reservation-actions"><Link className="admin-button admin-reservation-review" to={`/admin/reservations/${r.id}/payment-review?payment=${p.id}`}>Review Payment</Link></td></tr>)}</tbody></table></div> : <p>No deposits awaiting review on this page.</p>}
        {last_page > 1 && <AdminPagination page={current_page} lastPage={last_page} total={total} onChange={value => setParams({ tab: "deposit-review", page: String(value) })} />}
    </section>}</AdminResource>;
}
