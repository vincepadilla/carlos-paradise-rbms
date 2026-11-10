import { Link, NavLink, useLocation } from "react-router";
import { Icon, type IconName } from "../reservations/ReservationUI";
import AdminSignOutButton from "./AdminSignOutButton";
import { useAdminNotifications } from "./AdminNotificationsContext";

export const adminNavigation: { path: string; label: string; icon: IconName; mobileLabel?: string }[] = [
    { path: "dashboard", label: "Dashboard", icon: "home" },
    { path: "reservations", label: "Reservation Management", mobileLabel: "Reservations", icon: "credit" },
    { path: "calendar", label: "Calendar", icon: "calendar" },
    { path: "guests", label: "Guests", icon: "people" },
    { path: "reports", label: "Reports", icon: "sparkle" },
    { path: "notifications", label: "Notifications", icon: "clock" },
];

export function AdminNavLinks({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
    const { pathname } = useLocation();
    const { unreadCount } = useAdminNotifications();
    return (mobile ? adminNavigation.slice(0, 4) : adminNavigation).map(item => {
        const isNotifications = item.path === "notifications";
        return <NavLink
            key={item.path} to={`/admin/${item.path}`} onClick={onNavigate}
            className={({ isActive }) => `admin-nav-link${isActive || (item.path === "reservations" && pathname === "/admin/queue") ? " admin-nav-active" : ""}`}>
            {mobile ? <><Icon name={item.icon} size={16} /><span>{item.mobileLabel ?? item.label}</span></> : <>
                <span className="admin-nav-copy"><Icon name={item.icon} size={16} /><span>{item.label}</span></span>
                {isNotifications && unreadCount > 0 && <span className="admin-sidebar-notification-count" aria-hidden="true">
                    {unreadCount > 99 ? "99+" : unreadCount}
                </span>}
                {isNotifications && <span className="sr-only" aria-live="polite">
                    {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "No unread notifications"}
                </span>}
            </>}
        </NavLink>;
    });
}

export default function AdminSidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
    return <aside id="admin-sidebar" className={`admin-sidebar${open ? " admin-sidebar-open" : ""}`}>
        <Link to="/admin/dashboard" className="admin-logo" aria-label="Carlos Paradise Admin Dashboard" onClick={onNavigate}>
            <span className="admin-logo-mark"><img src="/assets/carlos-paradise-logo.jpg" alt="" /></span>
            <span><b>Carlos</b><strong>Paradise</strong></span>
        </Link>
        <div className="admin-portal-label">Admin Portal</div>
        <nav aria-label="Admin navigation">
            <AdminNavLinks onNavigate={onNavigate} />
            <button type="button" className="admin-nav-link admin-nav-unavailable" disabled title="System Settings is not available yet">
                <Icon name="shield" size={16} /><span>System Settings<span className="sr-only"> (not available yet)</span></span>
            </button>
        </nav>
        <div className="admin-sidebar-footer">
            <Link to="/admin/help" onClick={onNavigate}><Icon name="sparkle" size={16} />Help &amp; Support</Link>
            <AdminSignOutButton />
        </div>
    </aside>;
}
