import { useCallback, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import AdminPagination from "../../components/admin/AdminPagination";
import { OwnerApi } from "../../services/OwnerApi";
import { OwnerPage, ownerDate } from "./OwnerUI";

export default function OwnerAuditPage() {
    const [query, setQuery] = useSearchParams();
    const [verification, setVerification] = useState<"idle" | "verifying" | "verified" | "broken">("idle");
    const serialized = query.toString();
    const load = useCallback(async (signal: AbortSignal) => {
        try {
            const result = await OwnerApi.audit(new URLSearchParams(serialized), signal);
            if (!signal.aborted) setVerification(current => current === "verifying" ? result.integrity.status : "idle");
            return result;
        } catch (error) {
            if (!signal.aborted) setVerification("idle");
            throw error;
        }
    }, [serialized]);
    function verifyAgain() {
        setVerification("verifying");
        setQuery(current => {
            const next = new URLSearchParams(current);
            next.set("check", Date.now().toString());
            return next;
        });
    }
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
                <div className={`owner-audit-integrity ${data.integrity.status}`} role={data.integrity.status === "broken" ? "alert" : "status"}>
                    <strong>{data.integrity.status === "verified" ? "Audit hash chain verified" : "Audit integrity check failed"}</strong>
                    <p>{data.integrity.status === "verified" ? `${data.integrity.verified_entries} entries verified.` : `${data.integrity.failure?.reason}${data.integrity.failure?.entry_id ? ` Entry #${data.integrity.failure.entry_id}.` : ""}`} Checked {ownerDate(data.integrity.checked_at)}.</p>
                    <small>Verification covers recorded events and reservation/payment history. Changes made directly to other records require a separate check. Detecting a complete rewrite also requires an independently protected checkpoint.</small>
                    <button type="button" className="admin-button" disabled={verification === "verifying"} aria-busy={verification === "verifying"} onClick={verifyAgain}>
                        {verification === "verifying" ? "Verifying…" : "Verify again"}
                    </button>
                    <p role="status" aria-live="polite" aria-atomic="true">
                        {verification === "verifying" && "Checking the audit history. Please wait…"}
                        {verification === "verified" && "Verification complete. The audit hash chain is valid."}
                        {verification === "broken" && "Verification complete. An integrity problem was detected. Review the details above."}
                    </p>
                </div>
                <form key={serialized} className="owner-toolbar" onSubmit={applyFilters}>
                    <label className="owner-field">Search<input name="search" type="search" maxLength={200} placeholder="User, action, or details…" defaultValue={query.get("search") ?? ""} /></label>
                    <label className="owner-field">Date<input name="date" type="date" defaultValue={query.get("date") ?? ""} /></label>
                    {([['module', 'Module', data.filters.modules], ['action', 'Action', data.filters.actions]] as const).map(([key, label, values]) => <label className="owner-field" key={key}>{label}<select name={key} defaultValue={query.get(key) ?? ""}><option value="">All {label.toLowerCase()}s</option>{values.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>)}
                    <button className="btn btn-primary">Apply Filters</button><button type="button" className="admin-button" onClick={() => setQuery({})}>Clear Filters</button>
                </form>
                <div className="admin-table-scroll"><table className="admin-table owner-audit-table"><thead><tr><th>Date &amp; Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Details</th></tr></thead><tbody>{data.data.map(row => <tr key={`${row.source}-${row.id}`}><td><time dateTime={row.occurred_at}>{ownerDate(row.occurred_at)}</time></td><td>{row.user_name}{row.user_id !== null && <small> (#{row.user_id})</small>}</td><td>{row.role}</td><td>{row.action.replaceAll('_', ' ')}</td><td>{row.module}</td><td>{row.details}<details><summary>Hash chain · #{row.sequence}</summary><small>SHA-256: <code>{row.event_hash}</code><br />Previous: <code>{row.previous_hash}</code></small></details></td></tr>)}</tbody></table></div>
                {!data.data.length && <p className="owner-empty">No recorded activity matches these filters.</p>}
                <AdminPagination page={data.current_page} lastPage={data.last_page} total={data.total} onChange={page => { const next = new URLSearchParams(query); next.set("page", String(page)); setQuery(next); }} />
            </>}</AdminResource>
        </div>
    </OwnerPage>;
}
