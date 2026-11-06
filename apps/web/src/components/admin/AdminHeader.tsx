import { Link } from "react-router";
import { useAdminSession } from "../auth/RequireAdmin";
import { Icon } from "../reservations/ReservationUI";
import { initials } from "../../utils/adminDashboard";

export default function AdminHeader({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
    const { user } = useAdminSession();
    return <header className="admin-header">
        <button type="button" className="admin-menu-toggle" aria-label={menuOpen ? "Close Admin menu" : "Open Admin menu"}
            aria-expanded={menuOpen} aria-controls="admin-sidebar" onClick={onToggleMenu}>
            <Icon name="menu" />
        </button>
        <div className="admin-welcome">
            <b>Welcome to Carlos Paradise</b>
            <span>Manage reservations, guests, schedules, and daily operations from one place.</span>
        </div>
        <div className="admin-header-tools">
            <Link to="/admin/notifications" className="admin-notification" aria-label="Notifications">●</Link>
            <span className="admin-avatar" aria-hidden="true">{initials(user.name)}</span>
            <div className="admin-profile"><b>{user.name}</b><small>Admin</small></div>
        </div>
    </header>;
}
