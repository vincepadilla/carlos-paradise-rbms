import { StaffLink as Link } from "../../components/admin/StaffRouting";
import { useCallback } from "react";
import { useLocation, useParams } from "react-router";
import { dateTime, money, statusLabel } from "../../api";
import AdminResource from "../../components/admin/AdminResource";
import StatusBadge from "../../components/admin/StatusBadge";
import { AdminApi } from "../../services/AdminApi";
import type { AdminGuestDetails, AdminGuestReservation } from "../../types/admin";

export type GuestHistoryView = "reservations" | "payments" | "activity";

const viewCopy: Record<GuestHistoryView, { title: string; description: string }> = {
    reservations: { title: "Guest Reservations", description: "Current and previous reservations belonging to this guest." },
    payments: { title: "Payment History", description: "Deposit and payment records associated with this guest’s reservations." },
    activity: { title: "Guest Activity", description: "Recorded account and reservation activity for this guest." },
};

function guestCount(reservation: AdminGuestReservation) {
    const count = reservation.adults + reservation.children;
    return `${count} ${count === 1 ? "guest" : "guests"}`;
}

function ReservationsView({ data }: { data: AdminGuestDetails }) {
    if (!data.reservations.length) return <div className="admin-guest-history-empty"><strong>No reservations found</strong><p>This guest has no reservation history.</p></div>;
    return <div className="admin-table-scroll"><table className="admin-table admin-guest-history-table">
        <thead><tr><th>Reservation ID</th><th>Stay</th><th>Guests</th><th>Status</th></tr></thead>
        <tbody>{data.reservations.map(reservation => <tr key={reservation.id}>
            <td><Link to={`/admin/reservations/${reservation.id}`}>{reservation.booking_reference}</Link></td>
            <td>{dateTime(reservation.starts_at)}<br />to {dateTime(reservation.ends_at)}</td>
            <td>{guestCount(reservation)}</td><td><StatusBadge status={reservation.status} /></td>
        </tr>)}</tbody>
    </table></div>;
}

function PaymentsView({ data }: { data: AdminGuestDetails }) {
    if (!data.payments.length) return <div className="admin-guest-history-empty"><strong>No payments found</strong><p>No deposit or payment records are associated with this guest’s reservations.</p></div>;
    return <div className="admin-table-scroll"><table className="admin-table admin-guest-history-table">
        <thead><tr><th>Reservation</th><th>Payment Reference</th><th>Method</th><th>Amount</th><th>Status</th><th>Submitted</th></tr></thead>
        <tbody>{data.payments.map(payment => <tr key={payment.id}>
            <td><Link to={`/admin/reservations/${payment.reservation_id}`}>{payment.booking_reference}</Link></td>
            <td>{payment.reference || "—"}</td><td>{payment.method || "—"}</td><td>{money(payment.amount)}</td>
            <td>{payment.status === "approved" ? "Verified" : payment.status === "submitted" ? "Awaiting Review" : statusLabel(payment.status)}</td>
            <td>{dateTime(payment.submitted_at)}</td>
        </tr>)}</tbody>
    </table></div>;
}

function eventLabel(event: string) {
    return event.split("_").map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" ");
}

function ActivityView({ data }: { data: AdminGuestDetails }) {
    if (!data.activity.length) return <div className="admin-guest-history-empty"><strong>No activity found</strong><p>No recorded account or reservation activity is available for this guest.</p></div>;
    return <ol className="admin-guest-activity-list">{data.activity.map(activity => <li key={activity.id}>
        <span className="admin-guest-activity-icon" aria-hidden="true" />
        <div><strong>{eventLabel(activity.event)}</strong>
            <p>{activity.booking_reference ? <Link to={`/admin/reservations/${activity.reservation_id}`}>{activity.booking_reference}</Link> : "Guest account"}
                {activity.from_status !== activity.to_status && activity.to_status ? ` · ${activity.from_status ? `${statusLabel(activity.from_status)} → ` : ""}${statusLabel(activity.to_status)}` : ""}</p>
            {activity.reason && <p>{activity.reason}</p>}
            <small>{dateTime(activity.occurred_at)}{activity.actor_name ? ` · ${activity.actor_name}` : ""}</small>
        </div>
    </li>)}</ol>;
}

export default function AdminGuestHistoryPage({ view }: { view: GuestHistoryView }) {
    const { id = "" } = useParams();
    const location = useLocation();
    const listSearch = (location.state as { guestListSearch?: string } | null)?.guestListSearch ?? "";
    const validId = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
    const load = useCallback((signal: AbortSignal) => AdminApi.guest(id, signal), [id]);
    const copy = viewCopy[view];

    if (!validId) return <section className="admin-guest-history-page"><Link to="/admin/guests" className="admin-guest-back">← Back to Guests</Link><div role="alert" className="admin-guest-history-shell">This guest is unavailable.</div></section>;

    return <section className="admin-guest-history-page" aria-labelledby="guest-history-title">
        <Link to={`/admin/guests/${id}`} state={{ guestListSearch: listSearch }} className="admin-guest-back">← Back to Guest Details</Link>
        <header className="admin-guest-history-heading"><h1 id="guest-history-title">{copy.title}</h1><p>{copy.description}</p></header>
        <AdminResource load={load} showRefresh={false}>{data => <div className="admin-guest-history-shell">
            <div className="admin-guest-history-guest"><strong>{data.guest.name}</strong><span>{data.guest.email}</span></div>
            {view === "reservations" ? <ReservationsView data={data} /> : view === "payments" ? <PaymentsView data={data} /> : <ActivityView data={data} />}
        </div>}</AdminResource>
    </section>;
}
