import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import AdminHeader from "./AdminHeader";
import AdminSidebar, { AdminNavLinks } from "./AdminSidebar";
import "./admin.css";

export default function AdminLayout() {
    const [menuOpen, setMenuOpen] = useState(false);
    const shell = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menuOpen) return;
        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setMenuOpen(false);
                shell.current?.querySelector<HTMLButtonElement>(".admin-menu-toggle")?.focus();
            }
        }
        shell.current?.querySelector<HTMLAnchorElement>(".admin-sidebar nav a")?.focus();
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [menuOpen]);
    return <div className="admin-shell" ref={shell}>
        <a href="#admin-content" className="admin-skip-link">Skip to content</a>
        <AdminSidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        {menuOpen && <button type="button" className="admin-menu-backdrop" aria-label="Close Admin menu" onClick={() => setMenuOpen(false)} />}
        <div className="admin-body">
            <AdminHeader menuOpen={menuOpen} onToggleMenu={() => setMenuOpen(value => !value)} />
            <main id="admin-content" className="admin-content" tabIndex={-1}><Outlet /></main>
        </div>
        <nav className="admin-mobile-bottom" aria-label="Mobile Admin navigation"><AdminNavLinks mobile /></nav>
    </div>;
}
