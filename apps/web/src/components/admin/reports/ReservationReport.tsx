import { useStaffNavigate as useNavigate } from "../StaffRouting";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { type SetURLSearchParams } from "react-router";
import { statusLabel } from "../../../api";
import { AdminApi } from "../../../services/AdminApi";
import type { ReservationReportFilters, ReservationReportResponse, ReservationReportRow } from "../../../types/reports";

const DATE_RANGES = [
    ["all", "All Dates"],
    ["this_month", "This Month"],
    ["last_month", "Last Month"],
    ["this_year", "This Year"],
    ["custom", "Custom Range"],
] as const;

const STATUSES = ["pending", "queued", "awaiting_deposit", "payment_review", "confirmed", "ongoing", "completed", "cancelled", "rejected", "expired"];

export type ReservationReportActions = {
    print: () => void;
    exportCsv: () => void;
    busy: boolean;
};

type Props = {
    reportType: "reservation" | "guest";
    params: URLSearchParams;
    setParams: SetURLSearchParams;
    onBusyChange: (busy: boolean) => void;
};

function filtersFrom(params: URLSearchParams): ReservationReportFilters {
    const range = params.get("range");
    return {
        search: params.get("search") ?? "",
        date_range: DATE_RANGES.some(([value]) => value === range) ? range as ReservationReportFilters["date_range"] : "this_month",
        status: STATUSES.includes(params.get("status") ?? "") ? params.get("status")! : "",
        start_date: params.get("start") ?? "",
        end_date: params.get("end") ?? "",
    };
}

function queryFrom(filters: ReservationReportFilters, page?: number): URLSearchParams {
    const query = new URLSearchParams({ date_range: filters.date_range });
    if (filters.search) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
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
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00+08:00`));
}

function stayDates(row: ReservationReportRow): string {
    return row.check_in_date === row.check_out_date ? date(row.check_in_date) : `${date(row.check_in_date)} – ${date(row.check_out_date)}`;
}

function pricingText(row: ReservationReportRow): string {
    const pricing = row.pricing;
    if (pricing.base_amount === null && pricing.final_amount === null) return "—";
    const parts = [`Base ${money(pricing.base_amount)}`];
    if (pricing.discount_confirmed_none) parts.push("No discount applied");
    else if (pricing.discount_amount !== null) parts.push(`Discount ${money(pricing.discount_amount)}`);
    else parts.push("Discount —");
    parts.push(`Final ${money(pricing.final_amount)}`);
    return parts.join(" · ");
}

function printHtml(report: ReservationReportResponse, reportTitle: string, reportType: "reservation" | "guest"): string {
    const guestRows = report.data.map(row => `<tr>
        <td>${escapeHtml(row.guest_name)}</td><td>${escapeHtml(row.booking_reference)}</td>
        <td>${escapeHtml(stayDates(row))}</td><td>${row.guest_count}</td>
        <td>${escapeHtml(statusLabel(row.status))}</td></tr>`).join("");
    const reservationRows = report.data.map(row => `<tr>
        <td>${escapeHtml(row.guest_name)}</td><td>${escapeHtml(row.booking_reference)}</td>
        <td>${escapeHtml(statusLabel(row.status))}</td><td>${escapeHtml(pricingText(row))}</td></tr>`).join("");
    const headings = reportType === "reservation"
        ? "<th>Guest</th><th>Reservation ID</th><th>Reservation Status</th><th>Pricing</th>"
        : "<th>Guest</th><th>Reservation ID</th><th>Requested Dates</th><th>Guests</th><th>Reservation Status</th>";
    const rows = reportType === "reservation" ? reservationRows : guestRows;
    const applied = report.filters.applied;
    const generated = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(report.generated_at));
    return `<!doctype html><html><head><title>${escapeHtml(reportTitle)}</title><style>
        @page{size:landscape;margin:12mm}body{font:10pt Arial;color:#111}h1{margin:0 0 5px;font-size:20pt}.meta{margin:0 0 14px;color:#333}
        table{width:100%;border-collapse:collapse}thead{display:table-header-group}th,td{padding:7px;border:1px solid #aaa;text-align:left;vertical-align:top}th{background:#eee;font-size:8pt;text-transform:uppercase}
        tr{break-inside:avoid}</style></head><body><h1>${escapeHtml(reportTitle)}</h1>
        <p class="meta">Date range: ${escapeHtml(applied.date_label)} | Search: ${escapeHtml(applied.search || "All guests and reservation IDs")} | Status: ${escapeHtml(applied.status ? statusLabel(applied.status) : "All statuses")} | Generated: ${escapeHtml(generated)} (Asia/Manila)</p>
        <table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

const ReservationReport = forwardRef<ReservationReportActions, Props>(function ReservationReport({ reportType, params, setParams, onBusyChange }, ref) {
    const navigate = useNavigate();
    const reportTitle = reportType === "guest" ? "Guest Report" : "Reservation Report";
    const reportName = reportType === "guest" ? "guest report" : "reservation report";
    const applied = useMemo(() => filtersFrom(params), [params]);
    const [draft, setDraft] = useState(applied);
    const [report, setReport] = useState<ReservationReportResponse | null>(null);
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
        const request = reportType === "guest" ? AdminApi.guestReport : AdminApi.reservationReport;
        request(queryFrom(applied, page), controller.signal)
            .then(setReport)
            .catch(cause => {
                if (cause instanceof DOMException && cause.name === "AbortError") return;
                setError(cause instanceof Error ? cause.message : `Unable to load the ${reportName}.`);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [applied, page, reportName, reportType, retry]);

    const updateUrl = useCallback((filters: ReservationReportFilters, nextPage = 1) => {
        const next = new URLSearchParams({ tab: reportType });
        if (filters.search) next.set("search", filters.search);
        if (filters.date_range !== "this_month") next.set("range", filters.date_range);
        if (filters.status) next.set("status", filters.status);
        if (filters.date_range === "custom") {
            if (filters.start_date) next.set("start", filters.start_date);
            if (filters.end_date) next.set("end", filters.end_date);
        }
        if (nextPage > 1) next.set("page", String(nextPage));
        setParams(next);
    }, [reportType, setParams]);

    const print = useCallback(async () => {
        const popup = window.open("", "_blank");
        if (!popup) {
            setError("Printing was blocked. Allow pop-ups for this site and try again.");
            return;
        }
        popup.opener = null;
        popup.document.write(`<p>Preparing complete ${reportName}…</p>`);
        setAction("print");
        onBusyChange(true);
        try {
            const request = reportType === "guest" ? AdminApi.guestReportPrint : AdminApi.reservationReportPrint;
            const complete = await request(queryFrom(applied));
            popup.document.open();
            popup.document.write(printHtml(complete as ReservationReportResponse, reportTitle, reportType));
            popup.document.close();
            popup.focus();
            popup.print();
        } catch (cause) {
            popup.close();
            setError(cause instanceof Error ? cause.message : `Unable to prepare the ${reportName} for printing.`);
        } finally {
            setAction("");
            onBusyChange(false);
        }
    }, [applied, onBusyChange, reportName, reportTitle, reportType]);

    const exportCsv = useCallback(async () => {
        setAction("export");
        onBusyChange(true);
        try {
            const request = reportType === "guest" ? AdminApi.exportGuestReport : AdminApi.exportReservationReport;
            const { blob, filename } = await request(queryFrom(applied));
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : `Unable to export the ${reportName}.`);
        } finally {
            setAction("");
            onBusyChange(false);
        }
    }, [applied, onBusyChange, reportName, reportType]);

    useImperativeHandle(ref, () => ({ print, exportCsv, busy: action !== "" }), [print, exportCsv, action]);

    const openReservation = (id: number) => {
        const returnTo = `/admin/reports?${params.toString()}`;
        navigate(`/admin/reservations/${id}?returnTo=${encodeURIComponent(returnTo)}`);
    };

    return <section className="reservation-report-card" aria-labelledby={`${reportType}-report-title`}>
        <form className="reservation-report-filters" onSubmit={event => {
            event.preventDefault();
            if (draft.date_range === "custom" && (!draft.start_date || !draft.end_date)) {
                setError("Choose both a start date and an end date for the custom range.");
                return;
            }
            updateUrl(draft);
        }}>
            <label className="report-search"><span>Search</span><input value={draft.search} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder="Search guest or reservation ID" /></label>
            <label><span>Date Range</span><select value={draft.date_range} onChange={event => setDraft(current => ({ ...current, date_range: event.target.value as ReservationReportFilters["date_range"] }))}>{DATE_RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {draft.date_range === "custom" && <>
                <label><span>Start Date</span><input type="date" value={draft.start_date} onChange={event => setDraft(current => ({ ...current, start_date: event.target.value }))} /></label>
                <label><span>End Date</span><input type="date" min={draft.start_date || undefined} value={draft.end_date} onChange={event => setDraft(current => ({ ...current, end_date: event.target.value }))} /></label>
            </>}
            <label><span>Status</span><select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}><option value="">All Statuses</option>{STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
            <button className="report-apply" type="submit">Apply Filters</button>
            <button className="report-reset" type="button" onClick={() => updateUrl({ search: "", date_range: "this_month", status: "", start_date: "", end_date: "" })}>Reset</button>
        </form>

        <div className="reservation-report-heading">
            <div><h2 id={`${reportType}-report-title`}>{reportTitle}</h2><p>{report ? `${report.total.toLocaleString()} matching record${report.total === 1 ? "" : "s"} · ${report.filters.applied.date_label}` : "Loading report summary…"}</p></div>
            {action && <span role="status">{action === "print" ? "Preparing print…" : "Preparing CSV…"}</span>}
        </div>

        {error && <div className="report-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
        {loading ? <div className="report-state" role="status">Loading {reportName}…</div> :
            !report || report.data.length === 0 ? <div className="report-state"><strong>No reservations found</strong><span>Try changing the applied filters.</span></div> :
            <div className="reservation-report-table-scroll"><table className={`reservation-report-table report-table-${reportType}`}>
                <thead><tr>{reportType === "reservation"
                    ? <><th>Guest</th><th>Reservation ID</th><th>Reservation Status</th><th>Pricing</th></>
                    : <><th>Guest</th><th>Reservation ID</th><th>Requested Dates</th><th>Guests</th><th>Reservation Status</th></>}</tr></thead>
                <tbody>{report.data.map(row => <tr key={row.id} tabIndex={0} role="link" aria-label={`Open reservation ${row.booking_reference}`} onClick={() => openReservation(row.id)} onKeyDown={event => { if (event.key === "Enter") openReservation(row.id); }}>
                    <td className="report-guest">{row.guest_name || "—"}</td>
                    <td>{row.booking_reference || "—"}</td>
                    {reportType === "reservation" ? <>
                        <td><span className={`report-status report-status-${row.status}`}>{statusLabel(row.status)}</span></td>
                        <td className="report-pricing"><span>Base {money(row.pricing.base_amount)}</span>{row.pricing.discount_confirmed_none ? <span>No discount applied</span> : row.pricing.discount_amount !== null ? <span>Discount {money(row.pricing.discount_amount)}</span> : <span>Discount —</span>}<strong>Final {money(row.pricing.final_amount)}</strong></td>
                    </> : <>
                        <td>{stayDates(row)}</td>
                        <td>{row.guest_count}<small>{row.adults} adult{row.adults === 1 ? "" : "s"} · {row.children} child{row.children === 1 ? "" : "ren"}</small></td>
                        <td><span className={`report-status report-status-${row.status}`}>{statusLabel(row.status)}</span></td>
                    </>}
                </tr>)}</tbody>
            </table></div>}

        {report && report.total > 0 && <footer className="reservation-report-footer">
            <span>Showing {report.from ?? 0}–{report.to ?? 0} of {report.total}</span>
            <nav aria-label={`${reportTitle} pages`}>
                <button type="button" disabled={page <= 1 || loading} onClick={() => updateUrl(applied, page - 1)}>Previous</button>
                <span aria-current="page">Page {page} of {report.last_page}</span>
                <button type="button" disabled={page >= report.last_page || loading} onClick={() => updateUrl(applied, page + 1)}>Next</button>
            </nav>
        </footer>}
    </section>;
});

export default ReservationReport;
