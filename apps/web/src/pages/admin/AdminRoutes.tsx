import { Navigate, Route, Routes } from "react-router";
import { StaffLink as Link } from "../../components/admin/StaffRouting";
import RequireAdmin from "../../components/auth/RequireAdmin";
import RequireOwner from "../../components/auth/RequireOwner";
import OwnerDatabasePage from "../owner/OwnerDatabasePage";
import OwnerSettingsPage from "../owner/OwnerSettingsPage";
import OwnerAdminsPage from "../owner/OwnerAdminsPage";
import OwnerAuditPage from "../owner/OwnerAuditPage";
import AdminLayout from "../../components/admin/AdminLayout";
import AdminPage from "../../components/admin/AdminPage";
import AdminDashboardPage from "./AdminDashboardPage";
import AdminReservationsPage from "./AdminReservationsPage";
import AdminReservationDetailsPage from "./AdminReservationDetailsPage";
import AdminPaymentReviewPage from "./AdminPaymentReviewPage";
import AdminQueuePage from "./AdminQueuePage";
import AdminCalendarPage from "./AdminCalendarPage";
import AdminGuestsPage from "./AdminGuestsPage";
import AdminGuestDetailsPage from "./AdminGuestDetailsPage";
import AdminGuestHistoryPage from "./AdminGuestHistoryPage";
import AdminReportsPage from "./AdminReportsPage";
import AdminNotificationsPage from "./AdminNotificationsPage";
import AdminHelpPage from "./AdminHelpPage";

import AdminNotificationsProvider from '../../components/admin/AdminNotificationsContext';

export default function AdminRoutes({ portal = "admin" }: { portal?: "admin" | "owner" }) {
    return <Routes><Route element={portal === "owner" ? <RequireOwner /> : <RequireAdmin />}><Route element={<AdminNotificationsProvider><AdminLayout /></AdminNotificationsProvider>}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="reservations" element={<AdminReservationsPage />} />
        <Route path="reservations/:id" element={<AdminReservationDetailsPage />} />
        <Route path="reservations/:reservationId/payment-review" element={<AdminPaymentReviewPage />} />
        <Route path="queue" element={<AdminQueuePage />} />
        <Route path="calendar" element={<AdminCalendarPage />} />
        <Route path="guests" element={<AdminGuestsPage />} />
        <Route path="guests/:id" element={<AdminGuestDetailsPage />} />
        <Route path="guests/:id/reservations" element={<AdminGuestHistoryPage view="reservations" />} />
        <Route path="guests/:id/payments" element={<AdminGuestHistoryPage view="payments" />} />
        <Route path="guests/:id/activity" element={<AdminGuestHistoryPage view="activity" />} />
        <Route path="reports" element={<AdminReportsPage />} />
        <Route path="notifications" element={<AdminNotificationsPage />} />
        <Route path="help" element={<AdminHelpPage />} />
        {portal === "owner" && <>
            <Route path="database" element={<OwnerDatabasePage />} />
            <Route path="settings" element={<OwnerSettingsPage />} />
            <Route path="admin-management" element={<OwnerAdminsPage />} />
            <Route path="audit-trail" element={<OwnerAuditPage />} />
        </>}
        <Route path="*" element={<AdminPage title="Page not found"><Link to="/admin/dashboard" className="underline">Return to the {portal === "owner" ? "Owner" : "Admin"} Dashboard</Link></AdminPage>} />
    </Route></Route></Routes>;
}
