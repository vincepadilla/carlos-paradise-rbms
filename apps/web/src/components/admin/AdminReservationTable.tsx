import { Link } from "react-router";
import { dateTime, money, statusLabel } from "../../api";
import type { AdminReservation } from "../../types/admin";
import { isReviewablePayment } from "../../utils/paymentReview";
import StatusBadge from "./StatusBadge";

export const reservationScope = "Based on the latest 500 reservations returned by the reservation API. All times are Asia/Manila.";

export default function AdminReservationTable({ reservations, queue = false }: {
    reservations: AdminReservation[];
    queue?: boolean;
}) {
    if (!reservations.length) return <p>No reservations to display.</p>;
    return <div className="admin-table-scroll"><table className={`admin-table${queue ? "" : " admin-reservation-table"}`}>
        <caption>{queue ? "Unpaid requests and deposit opportunities" : "Reservations"}</caption>
        <thead><tr><th scope="col">Reference</th><th scope="col">Contact</th><th scope="col">Stay</th>
            <th scope="col">Status</th><th scope="col">{queue ? "Queue / opportunity" : "Agreed total"}</th>
            {!queue && <th scope="col" className="admin-reservation-actions">Actions</th>}
        </tr></thead>
        <tbody>{reservations.map(reservation => <tr key={reservation.id}>
            <td><Link to={`/admin/reservations/${reservation.id}`}>{reservation.reference}</Link></td>
            <td>{reservation.contact_name}</td>
            <td>{dateTime(reservation.starts_at)}<br />to {dateTime(reservation.ends_at)}</td>
            <td>{queue ? statusLabel(reservation.status) : <StatusBadge status={reservation.status} />}</td>
            <td>{queue ? <>
                <p>Position: {reservation.queue_position ?? "—"}</p>
                <p>Opportunity: {reservation.opportunity?.status ?? "None"}</p>
                <p>Deadline: {reservation.deadline ? dateTime(reservation.deadline) : "—"}</p>
            </> : money(reservation.total)}</td>
            {!queue && <td className="admin-reservation-actions">{reservation.payments?.some(payment => isReviewablePayment(reservation, payment))
                ? <Link className="admin-button admin-reservation-review" to={`/admin/reservations/${reservation.id}/payment-review`}>Review Payment</Link>
                : <span aria-label="No actions available">—</span>}</td>}
        </tr>)}</tbody>
    </table></div>;
}
