import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { dateTime, money } from "../../../api";
import { AdminApi } from "../../../services/AdminApi";
import type { DepositPaymentRecord, DepositPaymentStatus } from "../../../types/paymentReview";
import AdminResource from "../AdminResource";

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
});

const statusLabels: Record<DepositPaymentStatus, string> = {
    verified: "Verified",
    not_paid: "Not Yet Paid",
    awaiting_review: "Awaiting Review",
    rejected: "Rejected",
};

function stayDates(start: string, end: string): string {
    const first = dateFormatter.format(new Date(start));
    const last = dateFormatter.format(new Date(end));
    return first === last ? first : `${first} – ${last}`;
}

function statusClass(status: DepositPaymentStatus): string {
    if (status === "verified") return "deposit-status deposit-status-verified";
    if (status === "awaiting_review") return "deposit-status deposit-status-review";
    if (status === "rejected") return "deposit-status deposit-status-rejected";
    return "deposit-status deposit-status-unpaid";
}

function DepositRow({ record }: { record: DepositPaymentRecord }) {
    const navigate = useNavigate();
    const destination = `/admin/reservations/${record.reservation_id}/payment-review${record.latest_payment_id ? `?payment=${record.latest_payment_id}` : ""}`;
    const open = () => navigate(destination);

    return <tr
        tabIndex={0}
        aria-label={`Open deposit review for reservation ${record.reservation_reference}`}
        onClick={event => {
            if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea")) return;
            open();
        }}
        onKeyDown={event => {
            if (event.key === "Enter") {
                event.preventDefault();
                open();
            }
        }}
    >
        <td><strong className="deposit-reservation-reference">{record.reservation_reference}</strong></td>
        <td><strong>{record.guest_name}</strong></td>
        <td>{stayDates(record.starts_at, record.ends_at)}</td>
        <td>{record.payment_method ?? "—"}</td>
        <td>{record.total_submitted === null ? "—" : money(record.total_submitted)}</td>
        <td>{record.submitted_at ? dateTime(record.submitted_at) : "—"}</td>
        <td><span className={statusClass(record.status)}>{statusLabels[record.status]}</span></td>
    </tr>;
}

export default function DepositReviewList() {
    const [params, setParams] = useSearchParams();
    const requestedPage = Number(params.get("page") ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const search = params.get("search")?.trim() ?? "";
    const status = params.get("status") ?? "";
    const method = params.get("method") ?? "";
    const load = useCallback(
        (signal: AbortSignal) => AdminApi.paymentReviews(page, search, status, method, signal),
        [page, search, status, method],
    );

    const setFilter = (key: "search" | "status" | "method", value: string) => {
        const next = new URLSearchParams(params);
        next.set("tab", "deposit-review");
        next.delete("page");
        if (value) next.set(key, value);
        else next.delete(key);
        setParams(next, { replace: key === "search" });
    };

    const setPage = (value: number) => {
        const next = new URLSearchParams(params);
        next.set("tab", "deposit-review");
        if (value > 1) next.set("page", String(value));
        else next.delete("page");
        setParams(next);
    };

    return <AdminResource load={load} showRefresh={false} keepPreviousData>{data => {
        const first = data.from ?? 0;
        const last = data.to ?? 0;

        return <>
            <div className="deposit-review-toolbar" role="search">
                <label className="deposit-review-search">
                    <span className="sr-only">Search deposit payment records</span>
                    <input
                        type="search"
                        value={search}
                        placeholder="Search reservation, guest, or payment reference"
                        onChange={event => setFilter("search", event.target.value)}
                    />
                </label>
                <label>
                    <span className="sr-only">Filter by payment status</span>
                    <select value={status} onChange={event => setFilter("status", event.target.value)}>
                        <option value="">All Statuses</option>
                        {data.filters.statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label>
                    <span className="sr-only">Filter by payment method</span>
                    <select value={method} onChange={event => setFilter("method", event.target.value)}>
                        <option value="">All Methods</option>
                        {data.filters.methods.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                </label>
            </div>
            <section className="deposit-records-card" aria-label="Deposit payment records">
                <header className="deposit-records-header">
                    <div>
                        <h2>All Deposit Payment Records</h2>
                        <p>Open any row to view its complete payment and review history.</p>
                    </div>
                    <span className="deposit-record-count">{data.total} {data.total === 1 ? "record" : "records"}</span>
                </header>
                {data.data.length ? <div className="admin-table-scroll"><table className="admin-table admin-deposit-table">
                    <thead><tr>
                        <th scope="col">Reservation ID</th>
                        <th scope="col">Guest</th>
                        <th scope="col">Stay Dates</th>
                        <th scope="col">Payment Method</th>
                        <th scope="col">Total Submitted</th>
                        <th scope="col">Submitted At</th>
                        <th scope="col">Status</th>
                    </tr></thead>
                    <tbody>{data.data.map(record => <DepositRow key={record.reservation_id} record={record} />)}</tbody>
                </table></div> : <p className="deposit-records-empty">No deposit payment records match the current search and filters.</p>}
                <footer className="deposit-records-footer">
                    <span>{first}–{last} of {data.total}</span>
                    <nav aria-label="Deposit payment record pagination">
                        <button type="button" disabled={data.current_page <= 1} onClick={() => setPage(data.current_page - 1)}>Previous</button>
                        <span aria-current="page">{data.current_page}</span>
                        <button type="button" disabled={data.current_page >= data.last_page} onClick={() => setPage(data.current_page + 1)}>Next</button>
                    </nav>
                </footer>
            </section>
        </>;
    }}</AdminResource>;
}
