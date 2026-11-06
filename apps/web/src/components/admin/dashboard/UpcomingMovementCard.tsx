import { Link } from "react-router";
import { dashboardTime, guestCount, type VillaMovement } from "../../../utils/adminDashboard";
import { Icon } from "../../reservations/ReservationUI";
import StatusBadge from "../StatusBadge";
import DashboardPanel from "./DashboardPanel";

export default function UpcomingMovementCard({ movement, ongoingId }: { movement: VillaMovement | null; ongoingId?: number }) {
    const at = movement ? new Date(movement.at) : null;
    return <DashboardPanel title="Upcoming Check-ins / Check-outs" copy="Next scheduled villa movement" className="upcoming"
        action={<Link to="/admin/calendar">Open Calendar <Icon name="arrow" size={16} /></Link>}>
        {movement && at ? <Link className="upcoming-row" to={`/admin/reservations/${movement.reservation.id}`}>
            <strong><i>{new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", day: "numeric" }).format(at)}</i>
                {new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short" }).format(at).toUpperCase()}</strong>
            <div><b>{movement.reservation.reference}</b><span>{movement.reservation.contact_name} · {guestCount(movement.reservation)}</span></div>
            <StatusBadge status={movement.reservation.id === ongoingId ? "ongoing" : movement.reservation.status} />
            <div><b>{movement.kind}</b><span>{dashboardTime(movement.at)}</span></div>
        </Link> : <div className="dashboard-empty"><Icon name="calendar" /><b>No upcoming confirmed check-ins or check-outs</b></div>}
    </DashboardPanel>;
}
