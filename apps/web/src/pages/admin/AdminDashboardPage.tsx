import { StaffLink as Link } from "../../components/admin/StaffRouting";

import AdminPageHeader from "../../components/admin/AdminPageHeader";
import OngoingStayCard from "../../components/admin/dashboard/OngoingStayCard";
import UpcomingMovementCard from "../../components/admin/dashboard/UpcomingMovementCard";
import DashboardCharts from "../../components/admin/dashboard/DashboardCharts";
import DashboardPanel from "../../components/admin/dashboard/DashboardPanel";
import DashboardSummaryCards from "../../components/admin/dashboard/DashboardSummaryCards";
import { useDashboardSummary } from "../../hooks/useDashboardSummary";
import "../../components/admin/dashboard/dashboard.css";
import { useAdminSession } from "../../components/auth/RequireAdmin";

export default function AdminDashboardPage() {
    const { user } = useAdminSession();
    const role = user.role === "owner" ? "Owner" : "Admin";
    const { summary, error, retry } = useDashboardSummary();
    const pendingState = (title: string) => <DashboardPanel title={title} copy='Live reservation data'>
        <div className='dashboard-empty' role={error ? 'alert' : 'status'}>{error || 'Loading...'}</div>
    </DashboardPanel>;

    return <div className="admin-dashboard" aria-label={`${role} Dashboard`}>
        <AdminPageHeader eyebrow="Today's Overview" title={`Welcome back, ${role}!`} copy="Here’s what needs your attention today."
            action={<Link to="/admin/reservations" className="btn btn-primary">Open Reservation</Link>} />
        <DashboardSummaryCards summary={summary} error={error} onRetry={retry} />
        {summary ? <OngoingStayCard reservation={summary.ongoing_reservation} /> : pendingState('Ongoing Stay')}
        <DashboardCharts summary={summary} error={error} onRetry={retry} />
        {summary ? <UpcomingMovementCard movement={summary.upcoming_movement} ongoingId={summary.ongoing_reservation?.id} /> : pendingState('Upcoming Check-ins / Check-outs')}
    </div>;
}
