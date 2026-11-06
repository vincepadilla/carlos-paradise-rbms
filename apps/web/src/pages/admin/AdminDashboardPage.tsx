import { useEffect, useState } from "react";
import { Link } from "react-router";
import AdminPageHeader from "../../components/admin/AdminPageHeader";
import AdminResource from "../../components/admin/AdminResource";
import OngoingStayCard from "../../components/admin/dashboard/OngoingStayCard";
import ReservationQueuePreview from "../../components/admin/dashboard/ReservationQueuePreview";
import DepositReviewPreview from "../../components/admin/dashboard/DepositReviewPreview";
import UpcomingMovementCard from "../../components/admin/dashboard/UpcomingMovementCard";
import { AdminApi } from "../../services/AdminApi";
import { selectDashboard } from "../../utils/adminDashboard";
import "../../components/admin/dashboard/dashboard.css";

export default function AdminDashboardPage() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    return <div className="admin-dashboard" aria-label="Admin Dashboard">
        <AdminPageHeader eyebrow="Today's Overview" title="Welcome back, Admin!" copy="Here’s what needs your attention today."
            action={<Link to="/admin/reservations" className="btn btn-primary">Open Reservation</Link>} />
        <AdminResource load={AdminApi.reservations} showRefresh={false}>{({ reservations }) => {
            const dashboard = selectDashboard(reservations, now);
            return <>
                <OngoingStayCard reservation={dashboard.ongoing} />
                <div className="dashboard-grid operational-grid">
                    <ReservationQueuePreview reservations={dashboard.queue} />
                    <DepositReviewPreview />
                </div>
                <UpcomingMovementCard movement={dashboard.movement} ongoingId={dashboard.ongoing?.id} />
                <p className="dashboard-scope">Overview reflects the latest {reservations.length === 500 ? "500" : reservations.length} reservations. All times are Asia/Manila.</p>
            </>;
        }}</AdminResource>
    </div>;
}
