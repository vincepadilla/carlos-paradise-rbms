import { StaffLink as Link } from "../StaffRouting";

import type { AdminReservation } from "../../../types/admin";
import { money } from "../../../api";
import { dashboardDate, dashboardTime, depositState, guestCount, initials, stayDuration } from "../../../utils/adminDashboard";
import { Icon } from "../../reservations/ReservationUI";
import StatusBadge from "../StatusBadge";
import DashboardPanel from "./DashboardPanel";

export default function OngoingStayCard({ reservation }: { reservation: AdminReservation | null }) {
    const payment = reservation ? depositState(reservation) : null;
    return <DashboardPanel title="Ongoing Stay" copy="The single reservation currently occupying the private villa"
        className="today-reservation" action={<StatusBadge status={reservation ? "ongoing" : "neutral"}>{reservation ? "Ongoing Stay" : "No ongoing stay"}</StatusBadge>}>
        {reservation && payment ? <div className="today-reservation-content">
            <div className="today-guest">
                <span className="admin-avatar" aria-hidden="true">{initials(reservation.contact_name)}</span>
                <div><span>Guest</span><h3>{reservation.contact_name}</h3><small>Reservation ID · {reservation.reference}</small></div>
            </div>
            <div className="today-stay">
                <span><small>Check-in</small><b>{dashboardDate(reservation.starts_at)}</b><em>{dashboardTime(reservation.starts_at)}</em></span>
                <Icon name="arrow" />
                <span><small>Check-out</small><b>{dashboardDate(reservation.ends_at)}</b><em>{dashboardTime(reservation.ends_at)}</em></span>
            </div>
            <div className="today-facts">
                <span><small>Duration</small><b>{stayDuration(reservation)}</b></span>
                <span><small>Guests</small><b>{guestCount(reservation)}</b></span>
                <span><small>Payment</small><b>{payment.label}{payment.amount !== undefined && <> — {money(payment.amount)}</>}</b></span>
            </div>
            <Link className="btn btn-primary" to={`/admin/reservations/${reservation.id}`}>View Full Details</Link>
        </div> : <div className="dashboard-empty"><Icon name="calendar" /><div><b>No stay in progress</b><p>There is no confirmed reservation occupying the villa right now.</p></div></div>}
    </DashboardPanel>;
}
