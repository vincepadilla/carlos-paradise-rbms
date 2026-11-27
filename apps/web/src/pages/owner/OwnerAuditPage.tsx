import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import AdminPagination from "../../components/admin/AdminPagination";
import { useAdminSession } from "../../components/auth/RequireAdmin";
import { OwnerApi } from "../../services/OwnerApi";
import { ReservationApiError } from "../../services/ReservationApi";
import type { AuditResponse } from "../../types/owner";
import { OwnerPage, ownerDate } from "./OwnerUI";

export default function OwnerAuditPage() {
    const [query, setQuery] = useSearchParams();
    const { revalidate } = useAdminSession();
    const [data, setData] = useState<AuditResponse | null>(null);
    const [checkResult, setCheckResult] = useState<{ requestKey: string; state: "complete" | "error" } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [helpOpen, setHelpOpen] = useState(false);
    const serialized = query.toString();
    const requestKey = `${attempt}:${serialized}`;
    const checkState = checkResult?.requestKey === requestKey ? checkResult.state : "checking";
    useEffect(() => {
        const controller = new AbortController();
        void OwnerApi.audit(new URLSearchParams(serialized), controller.signal).then(result => {
            if (controller.signal.aborted) return;
            setData(result);
            setCheckResult({ requestKey, state: "complete" });
        }).catch((error: unknown) => {
            if (controller.signal.aborted) return;
            if (error instanceof ReservationApiError && (error.status === 401 || error.status === 403)) {
                revalidate();
                return;
            }
            setCheckResult({ requestKey, state: "error" });
        });
        return () => controller.abort();
    }, [serialized, requestKey, revalidate]);
    function checkAgain() {
        setAttempt(current => current + 1);
    }
    const integrity = data?.integrity;
    const status = checkState === "complete" ? integrity?.status : checkState;
    const title = status === "verified" ? "Audit history check passed"
        : status === "broken" ? "Audit history needs review"
        : status === "error" ? "Check could not be completed"
        : "Checking audit history…";
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
                <div className={`owner-audit-integrity ${status}`}>
                    <div role={status === "broken" || status === "error" ? "alert" : "status"} aria-atomic="true">
                        <strong>{title}</strong>
                        {status === "verified" && <p>The system checked {integrity?.verified_entries} recorded activities and found no mismatches in the audit history.</p>}
                        {status === "broken" && <>
                            <p>The check found a mismatch in the saved audit history.</p>
                            {integrity?.failure?.entry_id != null && <p>Affected entry number: {integrity.failure.entry_id}.</p>}
                        </>}
                        {status === "error" && <p>Please try again. {data ? "The last loaded activities are still shown below." : "The audit history could not be loaded."}</p>}
                    </div>
                    {integrity && <p className="owner-audit-last-checked">Last checked <time dateTime={integrity.checked_at}>{new Date(integrity.checked_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "medium" })}</time></p>}
                    <div className="owner-audit-check-actions">
                        <button type="button" className="admin-button" disabled={checkState === "checking"} aria-busy={checkState === "checking"} onClick={checkAgain}>
                            {checkState === "checking" ? "Checking audit history…" : "Check again"}
                        </button>
                        <button type="button" className="owner-audit-help-toggle" aria-expanded={helpOpen} aria-controls="owner-audit-help" onClick={() => setHelpOpen(current => !current)}>What does this check?</button>
                    </div>
                    <p id="owner-audit-help" className="owner-audit-help" hidden={!helpOpen}>Each recorded activity has a digital fingerprint that links it to the activity before it. The system checks these fingerprints for signs that saved audit entries were changed. This result shows when the audit history was last checked and whether it needs review.</p>
                </div>
            {data && <>
                <form key={serialized} className="owner-toolbar" onSubmit={applyFilters}>
                    <label className="owner-field">Search<input name="search" type="search" maxLength={200} placeholder="User, action, or details…" defaultValue={query.get("search") ?? ""} /></label>
                    <label className="owner-field">Date<input name="date" type="date" defaultValue={query.get("date") ?? ""} /></label>
                    {([['module', 'Module', data.filters.modules], ['action', 'Action', data.filters.actions]] as const).map(([key, label, values]) => <label className="owner-field" key={key}>{label}<select name={key} defaultValue={query.get(key) ?? ""}><option value="">All {label.toLowerCase()}s</option>{values.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>)}
                    <button className="btn btn-primary">Apply Filters</button><button type="button" className="admin-button" onClick={() => setQuery({})}>Clear Filters</button>
                </form>
                <div className="admin-table-scroll"><table className="admin-table owner-audit-table"><thead><tr><th>Date &amp; Time</th><th>User</th><th>Role</th><th>Action</th><th>Module</th><th>Details</th></tr></thead><tbody>{data.data.map(row => <tr key={`${row.source}-${row.id}`}><td><time dateTime={row.occurred_at}>{ownerDate(row.occurred_at)}</time></td><td>{row.user_name}{row.user_id !== null && <small> (#{row.user_id})</small>}</td><td>{row.role}</td><td>{row.action.replaceAll('_', ' ')}</td><td>{row.module}</td><td>{row.details}<details className="owner-audit-technical"><summary>Technical details</summary><dl><dt>Entry number</dt><dd>{row.sequence}</dd><dt>This entry’s fingerprint (SHA-256)</dt><dd><code>{row.event_hash}</code></dd><dt>Previous entry’s fingerprint</dt><dd><code>{row.previous_hash}</code></dd></dl></details></td></tr>)}</tbody></table></div>
                {!data.data.length && <p className="owner-empty">No recorded activity matches these filters.</p>}
                <AdminPagination page={data.current_page} lastPage={data.last_page} total={data.total} onChange={page => { const next = new URLSearchParams(query); next.set("page", String(page)); setQuery(next); }} />
            </>}
        </div>
    </OwnerPage>;
}
