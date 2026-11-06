import { useCallback } from "react";
import { Link, useParams } from "react-router";
import AdminPage from "../../components/admin/AdminPage";
import AdminResource from "../../components/admin/AdminResource";
import { AdminApi } from "../../services/AdminApi";

export default function AdminGuestDetailsPage() {
    const { id = "" } = useParams();
    const load = useCallback((signal: AbortSignal) => AdminApi.guest(id, signal), [id]);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        return <AdminPage title="Guest details"><p>Invalid guest ID.</p></AdminPage>;
    }
    return <AdminPage title="Guest details">
        <Link to="/admin/guests" className="mb-4 block text-brown underline">Back to guests</Link>
        <AdminResource load={load}>{({ guest }) => <dl className="admin-details">
            <dt>Name</dt><dd>{guest.name}</dd>
            <dt>Email</dt><dd>{guest.email}</dd>
            <dt>Phone</dt><dd>{guest.phone || "Not provided"}</dd>
            <dt>Account</dt><dd>{guest.is_active ? "Active" : "Inactive"}</dd>
            <dt>Email verified</dt><dd>{guest.email_verified_at ? "Yes" : "No"}</dd>
        </dl>}</AdminResource>
    </AdminPage>;
}
