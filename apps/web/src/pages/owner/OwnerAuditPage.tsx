import { useCallback, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import AdminPagination from "../../components/admin/AdminPagination";
import { OwnerApi } from "../../services/OwnerApi";
import { OwnerPage, ownerDate } from "./OwnerUI";

export default function OwnerAuditPage() {
    const [query, setQuery] = useSearchParams();
    const serialized = query.toString();
    const load = useCallback((signal: AbortSignal) => OwnerApi.audit(new URLSearchParams(serialized), signal), [serialized]);
    function applyFilters(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const next = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) => {
            if (typeof value === "string" && value.trim()) next.set(key, value.trim());
        });
        setQuery(next);
    }
    return <OwnerPage title="Audit Trail" copy="Review recorded resort activity and reservation history.">
        <div className="owner-card">
            <AdminResource load={load} keepPreviousData showRefresh={false}>{data => <>
                <form key={serialized} className="owner-toolbar" onSubmit={applyFilters}>
                    <label className="owner-field">Search<input name="search" type="search" maxLength={200} placeholder="User, action, or details…" defaultValue={query.get("search") ?? ""} /></label>
                    <label className="owner-field">Date<input name="date" type="date" defaultValue={query.get("date") ?? ""} /></label>
                    {([['module', 'Module', data.filters.modules], ['action', 'Action', data.filters.actions]] as const).map(([key, label, values]) => <label className="owner-field" key={key}>{label}<select name={key} defaultValue={query.get(key) ?? ""}><option value="">All {label.toLowerCase()}s</option>{values.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>)}
                    <button className="btn btn-primary">Apply Filters</button><button type="button" className="admin-button" onClick={() => setQuery({})}>Clear Filters</button>
                </form>
                <div className="admin-table-scroll"><table className="admin-table owner-audit-table"><thead><tr><th>Date &amp; Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Details</th></tr></thead><tbody>{data.data.map(row => <tr key={`${row.source}-${row.id}`}><td><time dateTime={row.occurred_at}>{ownerDate(row.occurred_at)}</time></td><td>{row.user_name}</td><td>{row.role}</td><td>{row.action.replaceAll('_', ' ')}</td><td>{row.module}</td><td>{row.details}</td></tr>)}</tbody></table></div>
                {!data.data.length && <p className="owner-empty">No recorded activity matches these filters.</p>}
                <AdminPagination page={data.current_page} lastPage={data.last_page} total={data.total} onChange={page => { const next = new URLSearchParams(query); next.set("page", String(page)); setQuery(next); }} />
            </>}</AdminResource>
        </div>
    </OwnerPage>;
}
