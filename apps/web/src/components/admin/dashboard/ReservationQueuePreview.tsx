import { StaffLink as Link } from "../StaffRouting";

import type { AdminReservation } from "../../../types/admin";
import { dashboardDate, initials } from "../../../utils/adminDashboard";
import { Icon } from "../../reservations/ReservationUI";
import StatusBadge from "../StatusBadge";
import DashboardPanel from "./DashboardPanel";

export default function ReservationQueuePreview({ reservations }: { reservations: AdminReservation[] }) {
    return <DashboardPanel title="Active Reservation Queue" copy="Requests currently requiring attention" className="queue-preview"
        action={<Link to="/admin/queue">View Queue <Icon name="arrow" size={16} /></Link>}>
        {reservations.length ? <div className="table-wrap"><table>
            <thead><tr><th scope="col">Queue #</th><th scope="col">Guest</th><th scope="col">Requested Dates</th><th scope="col">Status</th></tr></thead>
            <tbody>{reservations.slice(0, 2).map(reservation => <tr key={reservation.id}>
                <td><b>{reservation.queue_position == null ? "—" : `#${reservation.queue_position}`}</b></td>
                <td><Link className="guest-cell" to={`/admin/reservations/${reservation.id}`}><i aria-hidden="true">{initials(reservation.contact_name)}</i><b>{reservation.contact_name}</b></Link></td>
                <td>{dashboardDate(reservation.starts_at)} – {dashboardDate(reservation.ends_at)}</td>
                <td><StatusBadge status={reservation.status} /></td>
            </tr>)}</tbody>
        </table></div> : <div className="dashboard-empty"><Icon name="check" /><b>No requests awaiting attention</b></div>}
    </DashboardPanel>;
}
