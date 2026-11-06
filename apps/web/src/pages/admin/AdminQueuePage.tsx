import AdminPage from "../../components/admin/AdminPage";
import AdminResource from "../../components/admin/AdminResource";
import AdminReservationTable, { reservationScope } from "../../components/admin/AdminReservationTable";
import { AdminApi } from "../../services/AdminApi";

export default function AdminQueuePage() {
    return <AdminPage title="Queue" description={reservationScope}>
        <p className="mb-4 text-muted">Positions are calculated for overlapping stays. Each set of dates has its own queue.</p>
        <AdminResource load={AdminApi.reservations}>{({ reservations }) =>
            <AdminReservationTable queue reservations={reservations
                .filter(item => ["pending", "queued", "awaiting_deposit"].includes(item.status))
                .sort((left, right) => (left.queue_position ?? Infinity) - (right.queue_position ?? Infinity) || left.id - right.id)} />
        }</AdminResource>
    </AdminPage>;
}
