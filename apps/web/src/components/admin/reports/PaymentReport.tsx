import { useStaffNavigate as useNavigate } from "../StaffRouting";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { type SetURLSearchParams } from "react-router";
import { AdminApi } from "../../../services/AdminApi";
import type { PaymentReportFilters, PaymentReportResponse, PaymentReportRow } from "../../../types/reports";
import type { ReservationReportActions } from "./ReservationReport";

const DATE_RANGES = [
    ["all", "All Dates"],
    ["this_month", "This Month"],
    ["last_month", "Last Month"],
    ["this_year", "This Year"],
    ["custom", "Custom Range"],
] as const;

const PAYMENT_STATUSES = [
    ["unpaid", "Unpaid"],
    ["awaiting_review", "Awaiting Review"],
    ["partially_verified", "Partially Verified"],
    ["verified", "Verified"],
    ["rejected", "Rejected"],
] as const;

type Props = {
    params: URLSearchParams;
    setParams: SetURLSearchParams;
    onBusyChange: (busy: boolean) => void;
};

function filtersFrom(params: URLSearchParams): PaymentReportFilters {
    const range = params.get("range");
    const status = params.get("payment_status") ?? "";
    return {
        search: params.get("search") ?? "",
        date_range: DATE_RANGES.some(([value]) => value === range) ? range as PaymentReportFilters["date_range"] : "this_month",
        payment_status: PAYMENT_STATUSES.some(([value]) => value === status) ? status : "",
        start_date: params.get("start") ?? "",
        end_date: params.get("end") ?? "",
    };
}

function queryFrom(filters: PaymentReportFilters, page?: number): URLSearchParams {
    const query = new URLSearchParams({ date_range: filters.date_range });
    if (filters.search) query.set("search", filters.search);
    if (filters.payment_status) query.set("payment_status", filters.payment_status);
    if (filters.date_range === "custom") {
        if (filters.start_date) query.set("start_date", filters.start_date);
        if (filters.end_date) query.set("end_date", filters.end_date);
    }
    if (page) query.set("page", String(page));
    return query;
}

function money(value: string | null): string {
    if (value === null) return "—";
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
}

function date(value: string): string {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })
        .format(new Date(`${value}T00:00:00+08:00`));
}

function stayDates(row: PaymentReportRow): string {
    return row.check_in_date === row.check_out_date ? date(row.check_in_date) : `${date(row.check_in_date)} – ${date(row.check_out_date)}`;
}

function statusLabel(status: string): string {
    return PAYMENT_STATUSES.find(([value]) => value === status)?.[1] ?? status;
}

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function printHtml(report: PaymentReportResponse): string {
    const rows = report.data.map(row => `<tr>
        <td>${escapeHtml(row.booking_reference)}</td>
        <td>${escapeHtml(stayDates(row))}</td>
        <td>${row.guest_count}</td>
        <td>${escapeHtml(statusLabel(row.payment_status))}<br>Awaiting review: ${escapeHtml(money(row.submitted_amount))}<br>Verified: ${escapeHtml(money(row.verified_amount))}<br>Required: ${escapeHtml(money(row.required_amount))}</td>
        <td>${escapeHtml(row.methods.length ? row.methods.join(", ") : "—")}</td></tr>`).join("");
    const applied = report.filters.applied;
    const generated = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(report.generated_at));
    return `<!doctype html><html><head><title>Payment Report</title><style>
        @page{size:landscape;margin:12mm}body{font:10pt Arial;color:#111}h1{margin:0 0 5px;font-size:20pt}.meta{margin:0 0 14px;color:#333}
        table{width:100%;border-collapse:collapse}thead{display:table-header-group}th,td{padding:7px;border:1px solid #aaa;text-align:left;vertical-align:top}th{background:#eee;font-size:8pt;text-transform:uppercase}
        tr{break-inside:avoid}</style></head><body><h1>Payment Report</h1>
        <p class="meta">Date range: ${escapeHtml(applied.date_label)} | Search: ${escapeHtml(applied.search || "All reservation IDs and payment references")} | Payment status: ${escapeHtml(applied.payment_status ? statusLabel(applied.payment_status) : "All statuses")} | Generated: ${escapeHtml(generated)} (Asia/Manila)</p>
        <table><thead><tr><th>Reservation ID</th><th>Requested Dates</th><th>Guests</th><th>Payment Status</th><th>Method</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

const PaymentReport = forwardRef<ReservationReportActions, Props>(function PaymentReport({ params, setParams, onBusyChange }, ref) {
    const navigate = useNavigate();
    const applied = useMemo(() => filtersFrom(params), [params]);
    const [draft, setDraft] = useState(applied);
    const [report, setReport] = useState<PaymentReportResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [action, setAction] = useState<"" | "print" | "export">("");
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);

    useEffect(() => setDraft(applied), [applied]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        AdminApi.paymentReport(queryFrom(applied, page), controller.signal)
            .then(setReport)
            .catch(cause => {
                if (cause instanceof DOMException && cause.name === "AbortError") return;
                setError(cause instanceof Error ? cause.message : "Unable to load the payment report.");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [applied, page, retry]);

    const updateUrl = useCallback((filters: PaymentReportFilters, nextPage = 1) => {
        const next = new URLSearchParams({ tab: "payment" });
        if (filters.search) next.set("search", filters.search);
        if (filters.date_range !== "this_month") next.set("range", filters.date_range);
        if (filters.payment_status) next.set("payment_status", filters.payment_status);
        if (filters.date_range === "custom") {
            if (filters.start_date) next.set("start", filters.start_date);
            if (filters.end_date) next.set("end", filters.end_date);
        }
        if (nextPage > 1) next.set("page", String(nextPage));
        setParams(next);
    }, [setParams]);

    const print = useCallback(async () => {
        const popup = window.open("", "_blank");
        if (!popup) {
            setError("Printing was blocked. Allow pop-ups for this site and try again.");
            return;
        }
        popup.opener = null;
        popup.document.write("<p>Preparing complete payment report…</p>");
        setAction("print");
        onBusyChange(true);
        try {
            const complete = await AdminApi.paymentReportPrint(queryFrom(applied));
            popup.document.open();
            popup.document.write(printHtml(complete as PaymentReportResponse));
            popup.document.close();
            popup.focus();
            popup.print();
        } catch (cause) {
            popup.close();
            setError(cause instanceof Error ? cause.message : "Unable to prepare the payment report for printing.");
        } finally {
            setAction("");
            onBusyChange(false);
        }
    }, [applied, onBusyChange]);

    const exportCsv = useCallback(async () => {
        setAction("export");
        onBusyChange(true);
        try {
            const { blob, filename } = await AdminApi.exportPaymentReport(queryFrom(applied));
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to export the payment report.");
        } finally {
            setAction("");
            onBusyChange(false);
        }
    }, [applied, onBusyChange]);

    useImperativeHandle(ref, () => ({ print, exportCsv, busy: action !== "" }), [print, exportCsv, action]);

    const openReservation = (id: number) => {
        const returnTo = `/admin/reports?${params.toString()}`;
        navigate(`/admin/reservations/${id}?returnTo=${encodeURIComponent(returnTo)}`);
    };

    return <section className="reservation-report-card" aria-labelledby="payment-report-title">
        <form className="reservation-report-filters" onSubmit={event => {
            event.preventDefault();
            if (draft.date_range === "custom" && (!draft.start_date || !draft.end_date)) {
                setError("Choose both a start date and an end date for the custom range.");
                return;
            }
            updateUrl(draft);
        }}>
            <label className="report-search"><span>Search</span><input value={draft.search} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder="Search reservation ID or payment reference" /></label>
            <label><span>Date Range</span><select value={draft.date_range} onChange={event => setDraft(current => ({ ...current, date_range: event.target.value as PaymentReportFilters["date_range"] }))}>{DATE_RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {draft.date_range === "custom" && <>
                <label><span>Start Date</span><input type="date" value={draft.start_date} onChange={event => setDraft(current => ({ ...current, start_date: event.target.value }))} /></label>
                <label><span>End Date</span><input type="date" min={draft.start_date || undefined} value={draft.end_date} onChange={event => setDraft(current => ({ ...current, end_date: event.target.value }))} /></label>
            </>}
            <label><span>Payment Status</span><select value={draft.payment_status} onChange={event => setDraft(current => ({ ...current, payment_status: event.target.value }))}><option value="">All Statuses</option>{PAYMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button className="report-apply" type="submit">Apply Filters</button>
            <button className="report-reset" type="button" onClick={() => updateUrl({ search: "", date_range: "this_month", payment_status: "", start_date: "", end_date: "" })}>Reset</button>
        </form>

        <div className="reservation-report-heading">
            <div><h2 id="payment-report-title">Payment Report</h2><p>{report ? `${report.total.toLocaleString()} matching record${report.total === 1 ? "" : "s"} · ${report.filters.applied.date_label}` : "Loading report summary…"}</p></div>
            {action && <span role="status">{action === "print" ? "Preparing print…" : "Preparing CSV…"}</span>}
        </div>

        {error && <div className="report-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
        {loading ? <div className="report-state" role="status">Loading payment report…</div> :
            !report || report.data.length === 0 ? <div className="report-state"><strong>No payment records found</strong><span>Try changing the applied filters.</span></div> :
            <div className="reservation-report-table-scroll"><table className="reservation-report-table report-table-payment">
                <thead><tr><th>Reservation ID</th><th>Requested Dates</th><th>Guests</th><th>Payment Status</th><th>Method</th></tr></thead>
                <tbody>{report.data.map(row => <tr key={row.id} tabIndex={0} role="link" aria-label={`Open reservation ${row.booking_reference}`} onClick={() => openReservation(row.id)} onKeyDown={event => { if (event.key === "Enter") openReservation(row.id); }}>
                    <td>{row.booking_reference || "—"}</td>
                    <td>{stayDates(row)}</td>
                    <td>{row.guest_count}</td>
                    <td className="report-payment"><span className={`report-status report-payment-status-${row.payment_status}`}>{statusLabel(row.payment_status)}</span><small>Awaiting {money(row.submitted_amount)} · Verified {money(row.verified_amount)} · Required {money(row.required_amount)}</small></td>
                    <td className="report-methods">{row.methods.length ? row.methods.join(", ") : "—"}</td>
                </tr>)}</tbody>
            </table></div>}

        {report && report.total > 0 && <footer className="reservation-report-footer">
            <span>Showing {report.from ?? 0}–{report.to ?? 0} of {report.total}</span>
            <nav aria-label="Payment Report pages">
                <button type="button" disabled={page <= 1 || loading} onClick={() => updateUrl(applied, page - 1)}>Previous</button>
                <span aria-current="page">Page {page} of {report.last_page}</span>
                <button type="button" disabled={page >= report.last_page || loading} onClick={() => updateUrl(applied, page + 1)}>Next</button>
            </nav>
        </footer>}
    </section>;
});

export default PaymentReport;
