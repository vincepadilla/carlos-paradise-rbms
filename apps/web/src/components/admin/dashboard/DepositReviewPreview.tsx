import { StaffLink as Link } from "../StaffRouting";

import { money } from "../../../api";
import { Icon } from "../../reservations/ReservationUI";
import DashboardPanel from "./DashboardPanel";
import AdminResource from "../AdminResource";
import { AdminApi } from "../../../services/AdminApi";

export default function DepositReviewPreview() {
    return <AdminResource load={AdminApi.pendingPaymentPreview} showRefresh={false}>{({ data: deposits, total }) => <DashboardPanel title="Deposit Review" className="activity"
        copy={`${total} ${total === 1 ? "deposit" : "deposits"} awaiting review`}
        action={<Link to="/admin/reservations?tab=deposit-review">Review all</Link>}>
        {deposits.slice(0, 2).map(({ reservation, payment }) => <Link className="activity-action" to={`/admin/reservations/${reservation.id}/payment-review?payment=${payment.id}`} key={payment.id}>
            <span aria-hidden="true" /><div>{reservation.contact_name} · {money(payment.amount)}<small>{reservation.reference} · Awaiting Review</small></div>
        </Link>)}
        {!deposits.length && <div className="dashboard-empty"><Icon name="check" /><b>No deposits awaiting review</b></div>}
    </DashboardPanel>}</AdminResource>;
}
