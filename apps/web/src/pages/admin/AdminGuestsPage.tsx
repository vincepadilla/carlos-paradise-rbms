import { useCallback, useState } from "react";
import { Link } from "react-router";
import AdminPage from "../../components/admin/AdminPage";
import AdminPagination from "../../components/admin/AdminPagination";
import AdminResource from "../../components/admin/AdminResource";
import { AdminApi } from "../../services/AdminApi";

export default function AdminGuestsPage() {
    const [page, setPage] = useState(1);
    const load = useCallback((signal: AbortSignal) => AdminApi.guests(page, signal), [page]);
    return <AdminPage title="Guests" description="Registered accounts with the guest role.">
        <AdminResource key={page} load={load}>{guests => <>
            {guests.data.length ? <div className="admin-table-scroll"><table className="admin-table">
                <thead><tr><th scope="col">Guest</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Account</th></tr></thead>
                <tbody>{guests.data.map(guest => <tr key={guest.id}>
                    <td><Link to={`/admin/guests/${guest.id}`}>{guest.name}</Link></td><td>{guest.email}</td><td>{guest.phone || "—"}</td><td>{guest.is_active ? "Active" : "Inactive"}</td>
                </tr>)}</tbody>
            </table></div> : <p>No guest accounts found.</p>}
            <AdminPagination page={guests.current_page} lastPage={guests.last_page} total={guests.total} onChange={setPage} />
        </>}</AdminResource>
    </AdminPage>;
}
