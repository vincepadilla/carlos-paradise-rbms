import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import AdminPagination from "../../components/admin/AdminPagination";
import AdminResource from "../../components/admin/AdminResource";
import { Icon } from "../../components/reservations/ReservationUI";
import { AdminApi } from "../../services/AdminApi";

export default function AdminGuestsPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const search = searchParams.get("search") ?? "";
    const requestedPage = Number(searchParams.get("page") ?? "1");
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const load = useCallback((signal: AbortSignal) => AdminApi.guests(page, search.trim(), signal), [page, search]);

    function updateSearch(value: string) {
        setSearchParams(params => {
            const next = new URLSearchParams(params);
            if (value) next.set("search", value);
            else next.delete("search");
            next.delete("page");
            return next;
        }, { replace: true });
    }

    function updatePage(nextPage: number) {
        setSearchParams(params => {
            const next = new URLSearchParams(params);
            if (nextPage > 1) next.set("page", String(nextPage));
            else next.delete("page");
            return next;
        });
    }

    function guestPath(id: number) {
        return `/admin/guests/${id}`;
    }

    function openGuest(id: number) {
        navigate(guestPath(id), { state: { guestListSearch: location.search } });
    }

    function handleRowClick(event: MouseEvent<HTMLTableRowElement>, id: number) {
        if ((event.target as HTMLElement).closest("a")) return;
        openGuest(id);
    }

    function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: number) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openGuest(id);
    }

    return <section className="admin-guests-page" aria-labelledby="admin-guests-title">
        <header className="admin-guests-header">
            <h1 id="admin-guests-title">Guests</h1>
            <p>Search profiles and review reservation history.</p>
        </header>
        <div className="admin-guests-card">
            <label className="admin-guest-search">
                <span className="sr-only">Search guests</span>
                <Icon name="search" size={18} />
                <input type="search" value={search} maxLength={100} onChange={event => updateSearch(event.target.value)} placeholder="Search guest…" />
            </label>
            <AdminResource load={load} showRefresh={false}>{guests => <>
                {guests.data.length ? <div className="admin-table-scroll admin-guests-table-scroll"><table className="admin-table admin-guests-table">
                    <thead><tr><th scope="col">Guest Name</th><th scope="col">Contact Number</th><th scope="col">Email</th></tr></thead>
                    <tbody>{guests.data.map(guest => <tr key={guest.id} tabIndex={0} aria-label={`View details for ${guest.name}`}
                        onClick={event => handleRowClick(event, guest.id)} onKeyDown={event => handleRowKeyDown(event, guest.id)}>
                        <td><Link to={guestPath(guest.id)} state={{ guestListSearch: location.search }} tabIndex={-1}>
                            <span className="admin-guest-name">{guest.name || "—"}</span>
                            <span className="admin-guest-reference">{guest.latest_booking_reference || "—"}</span>
                        </Link></td>
                        <td>{guest.phone || "—"}</td>
                        <td>{guest.email || "—"}</td>
                    </tr>)}</tbody>
                </table></div> : <p className="admin-guests-empty">{search.trim() ? "No guests match your search." : "No guest accounts found."}</p>}
                <AdminPagination page={guests.current_page} lastPage={guests.last_page} total={guests.total} onChange={updatePage} />
            </>}</AdminResource>
        </div>
    </section>;
}
