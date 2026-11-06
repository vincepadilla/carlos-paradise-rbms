import { statusLabel } from "../../api";
import AdminPage from "../../components/admin/AdminPage";
import AdminResource from "../../components/admin/AdminResource";
import { reservationScope } from "../../components/admin/AdminReservationTable";
import { AdminApi } from "../../services/AdminApi";

export default function AdminReportsPage() {
    return <AdminPage title="Reports" description={reservationScope}>
        <AdminResource load={AdminApi.reservations}>{({ reservations }) => {
            const counts = new Map<string, number>();
            for (const reservation of reservations) counts.set(reservation.status, (counts.get(reservation.status) ?? 0) + 1);
            return reservations.length ? <div className="admin-table-scroll"><table className="admin-table">
                <caption>Booking status snapshot for {reservations.length} loaded reservations.</caption>
                <thead><tr><th scope="col">Status</th><th scope="col">Reservations</th></tr></thead>
                <tbody>{[...counts].sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) =>
                    <tr key={status}><td>{statusLabel(status)}</td><td>{count}</td></tr>
                )}</tbody>
            </table></div> : <p>No reservation data available.</p>;
        }}</AdminResource>
    </AdminPage>;
}
