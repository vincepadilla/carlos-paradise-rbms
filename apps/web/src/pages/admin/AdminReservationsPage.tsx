import { Link, useSearchParams } from "react-router";
import AdminPage from "../../components/admin/AdminPage";
import AdminResource from "../../components/admin/AdminResource";
import AdminReservationTable, { reservationScope } from "../../components/admin/AdminReservationTable";
import DepositReviewList from "../../components/admin/payment-review/DepositReviewList";
import { AdminApi } from "../../services/AdminApi";
import "../../components/admin/payment-review/payment-review.css";

export default function AdminReservationsPage() {
    const [params] = useSearchParams();
    const reviewing = params.get("tab") === "deposit-review";
    return <AdminPage title="Reservations" description={reviewing ? "Review every pending deposit submission. All times are Asia/Manila." : reservationScope}>
        <nav className="admin-reservation-tabs" aria-label="Reservation views"><Link to="/admin/reservations" aria-current={!reviewing ? "page" : undefined}>All Reservations</Link>
            <Link to="/admin/reservations?tab=deposit-review" aria-current={reviewing ? "page" : undefined}>Deposit Review</Link></nav>
        {reviewing ? <DepositReviewList /> : <AdminResource load={AdminApi.reservations}>{({ reservations }) => <AdminReservationTable reservations={reservations} />}</AdminResource>}
    </AdminPage>;
}
