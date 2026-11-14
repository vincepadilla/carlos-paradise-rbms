import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SetURLSearchParams } from 'react-router';
import { AdminApi } from '../../../services/AdminApi';
import type { ChartDatum, DashboardReport, ReportCardDatum, ReportKind } from '../../../types/interactiveReports';
import { useStaffNavigate as useNavigate } from '../StaffRouting';

export type InteractiveReportActions = {
    print: (mode: 'summary' | 'detailed') => void;
    exportCsv: () => void;
    busy: boolean;
};

type Props = {
    kind: ReportKind;
    params: URLSearchParams;
    setParams: SetURLSearchParams;
    onBusyChange: (busy: boolean) => void;
};

const DATE_RANGES = [
    ['all', 'All Dates'], ['this_month', 'This Month'], ['last_month', 'Last Month'],
    ['this_year', 'This Year'], ['custom', 'Custom Range'],
] as const;
const RESERVATION_STATUSES = ['pending', 'queued', 'awaiting_deposit', 'payment_review', 'confirmed', 'ongoing', 'completed', 'cancelled', 'rejected', 'expired'];
const PAYMENT_STATUSES = ['awaiting_review', 'verified', 'rejected'];
const QUEUE_STATUSES = ['queued', 'awaiting_deposit', 'payment_review', 'confirmed', 'expired', 'cancelled', 'rejected'];
const COLORS = ['#6f4c3a', '#b9855d', '#d7b98f', '#58705a', '#9a5d54', '#776a8b', '#b59e6d', '#496b78'];

type Filters = { search: string; date_range: string; status: string; start_date: string; end_date: string; period: string; guest_type: string; frequency: string; category: string; card: string };

function title(kind: ReportKind) {
    return kind === 'reservation' ? 'Reservation Report' : kind === 'guest' ? 'Guest Report' : kind === 'payment' ? 'Payment Report' : 'Reservation Queue Report';
}

function label(value: string) {
    return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function filtersFrom(params: URLSearchParams): Filters {
    return {
        search: params.get('search') ?? '', date_range: params.get('range') ?? 'this_month',
        status: params.get('status') ?? params.get('payment_status') ?? '',
        start_date: params.get('start') ?? '', end_date: params.get('end') ?? '',
        period: params.get('period') ?? '',
        guest_type: params.get('guest_type') ?? '', frequency: params.get('frequency') ?? '',
        category: params.get('category') ?? '', card: params.get('card') ?? '',
    };
}

function queryFrom(kind: ReportKind, filters: Filters, page?: number) {
    const query = new URLSearchParams({ dashboard: '1', date_range: filters.date_range });
    if (filters.search) query.set('search', filters.search);
    if (filters.status) query.set(kind === 'payment' ? 'payment_status' : 'status', filters.status);
    if (filters.period) query.set('period', filters.period);
    if (kind === 'guest' && filters.guest_type) query.set('guest_type', filters.guest_type);
    if (kind === 'guest' && filters.frequency) query.set('frequency', filters.frequency);
    if (kind === 'queue' && filters.category) query.set('category', filters.category);
    if (filters.card) query.set('card', filters.card);
    if (filters.date_range === 'custom') {
        if (filters.start_date) query.set('start_date', filters.start_date);
        if (filters.end_date) query.set('end_date', filters.end_date);
    }
    if (page && page > 1) query.set('page', String(page));
    return query;
}

function money(value: unknown) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value ?? 0));
}

function date(value: unknown, withTime = false) {
    if (!value) return '—';
    const raw = String(value);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00+08:00`) : new Date(raw);
    return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' as const } : {}) }).format(parsed);
}

function activate(event: KeyboardEvent<SVGElement>, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
}

function DonutChart({ title: chartTitle, data, selected, onSelect }: { title: string; data: ChartDatum[]; selected: string; onSelect: (item: ChartDatum) => void }) {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    let offset = 0;
    return <article className='report-chart-card'>
        <header><h3>{chartTitle}</h3><span>{total.toLocaleString()} total</span></header>
        {total === 0 ? <div className='chart-empty'>No data in this scope</div> : <div className='donut-layout'>
            <svg viewBox='0 0 120 120' className='donut-chart' role='img' aria-label={chartTitle}>
                <circle cx='60' cy='60' r='42' fill='none' stroke='#eee6db' strokeWidth='18' />
                {data.map((item, index) => {
                    const length = item.value / total * 263.89;
                    const start = offset; offset += length;
                    return <circle key={item.key} cx='60' cy='60' r='42' fill='none' stroke={COLORS[index % COLORS.length]}
                        strokeWidth={selected === item.key ? 22 : 18} strokeDasharray={`${length} ${263.89 - length}`}
                        strokeDashoffset={-start} transform='rotate(-90 60 60)' role='button' tabIndex={0}
                        aria-label={`${item.label}: ${item.value}. Apply filter`} onClick={() => onSelect(item)}
                        onKeyDown={event => activate(event, () => onSelect(item))}><title>{item.label}: {item.value}</title></circle>;
                })}
                <text x='60' y='58' textAnchor='middle' className='donut-total'>{total}</text>
                <text x='60' y='72' textAnchor='middle' className='donut-caption'>records</text>
            </svg>
            <div className='chart-legend'>{data.map((item, index) => <button type='button' key={item.key}
                className={selected === item.key ? 'selected' : ''} onClick={() => onSelect(item)}
                aria-pressed={selected === item.key}><i style={{ background: COLORS[index % COLORS.length] }} />{item.label}<b>{item.value}</b></button>)}</div>
        </div>}
    </article>;
}

function BarChart({ title: chartTitle, data, selected, onSelect, currency = false, horizontal = false }: { title: string; data: ChartDatum[]; selected: string; onSelect: (item: ChartDatum) => void; currency?: boolean; horizontal?: boolean }) {
    const max = Math.max(1, ...data.map(item => item.value));
    return <article className='report-chart-card'>
        <header><h3>{chartTitle}</h3><span>Click a {horizontal ? 'bar' : 'point'} to filter details</span></header>
        {!data.length ? <div className='chart-empty'>No data in this scope</div> : <div className={horizontal ? 'horizontal-bars' : 'trend-chart'} role='list' aria-label={chartTitle}>
            {data.map(item => <button type='button' role='listitem' key={item.key} className={selected === item.key ? 'selected' : ''} onClick={() => onSelect(item)} aria-pressed={selected === item.key}>
                <span>{item.label}</span><i><em style={{ width: `${Math.max(3, item.value / max * 100)}%` }} /></i><b>{currency ? money(item.value) : item.value.toLocaleString()}</b>
            </button>)}
        </div>}
    </article>;
}

function TrendChart({ title: chartTitle, data, selected, onSelect, currency = false }: { title: string; data: ChartDatum[]; selected: string; onSelect: (item: ChartDatum) => void; currency?: boolean }) {
    const max = Math.max(1, ...data.map(item => item.value));
    const points = data.map((item, index) => {
        const x = data.length === 1 ? 150 : 22 + index * 256 / (data.length - 1);
        const y = 112 - item.value / max * 86;
        return { item, x, y };
    });
    return <article className='report-chart-card'>
        <header><h3>{chartTitle}</h3><span>Click a point or label to filter</span></header>
        {!data.length ? <div className='chart-empty'>No data in this scope</div> : <>
            <svg className='line-chart' viewBox='0 0 300 130' role='img' aria-label={chartTitle}>
                <line x1='20' y1='112' x2='282' y2='112' stroke='#ded3c5' />
                <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill='none' stroke='#79533e' strokeWidth='3' />
                {points.map(({ item, x, y }) => <circle key={item.key} cx={x} cy={y} r={selected === item.key ? 7 : 5}
                    fill={selected === item.key ? '#3f2c22' : '#b9855d'} stroke='white' strokeWidth='2'
                    role='button' tabIndex={0} aria-label={`${item.label}: ${currency ? money(item.value) : item.value}. Apply filter`}
                    onClick={() => onSelect(item)} onKeyDown={event => activate(event, () => onSelect(item))}>
                    <title>{item.label}: {currency ? money(item.value) : item.value}</title>
                </circle>)}
            </svg>
            <div className='line-chart-labels'>{data.map(item => <button type='button' key={item.key} className={selected === item.key ? 'selected' : ''} onClick={() => onSelect(item)} aria-pressed={selected === item.key}><span>{item.label}</span><b>{currency ? money(item.value) : item.value}</b></button>)}</div>
        </>}
    </article>;
}

const HEADINGS: Record<ReportKind, string[]> = {
    reservation: ['Reservation', 'Stay & Guests', 'Guest', 'Status', 'Saved Pricing'],
    guest: ['Guest', 'Reservations', 'Stay History', 'Associated Reservation'],
    payment: ['Reservation', 'Payment Reference', 'Amount & Method', 'Payment Dates', 'Review Status'],
    queue: ['Reservation', 'Requested Stay', 'Queue Position', 'Queue Status', 'Event & Deadline'],
};

function textCells(kind: ReportKind, row: Record<string, unknown>): string[] {
    if (kind === 'reservation') {
        const pricing = row.pricing as Record<string, unknown>;
        const charges = (pricing.additional_charges as Array<Record<string, unknown>> ?? []).map(item => `${item.label}: ${money(item.amount)}`).join(', ');
        return [
            `${row.booking_reference} · ${label(String(row.reservation_type ?? ''))}`,
            `${date(row.check_in_date)} – ${date(row.check_out_date)} · ${row.guest_count} guests (${row.adults} adults, ${row.children} children, ${row.pets} pets)`,
            `${row.guest_name} · ${row.guest_email} · ${row.guest_phone}`,
            label(String(row.status)),
            `Base ${money(pricing.base_amount)} · Discount ${money(pricing.discount_amount)} · Final ${money(pricing.final_amount)}${charges ? ` · Additional charges: ${charges}` : ''}`,
        ];
    }
    if (kind === 'guest') return [
        `${row.guest_name} · ${row.guest_email} · ${row.guest_phone}`,
        `${row.reservation_count} in period · ${row.successful_reservations} successful · ${row.history_reservation_count} all-time`,
        `${date(row.first_stay_date)} – ${date(row.latest_stay_date)}`,
        String(row.associated_booking_reference ?? '—'),
    ];
    if (kind === 'payment') return [
        String(row.booking_reference ?? '—'), String(row.payment_reference ?? '—'),
        `${money(row.amount)} · ${row.method ?? '—'} · ${label(String(row.payment_kind ?? ''))}`,
        `Paid ${date(row.payment_date)} · Submitted ${date(row.submitted_at, true)} · Reviewed ${date(row.reviewed_at, true)}`,
        label(String(row.review_status)),
    ];
    return [
        String(row.booking_reference ?? '—'), `${date(row.check_in_date)} – ${date(row.check_out_date)}`,
        row.queue_position ? `#${row.queue_position}` : '—', label(String(row.status)),
        `Event ${date(row.event_date, true)} · Deadline ${date(row.deadline, true)}`,
    ];
}

function escapeHtml(value: unknown) {
    return String(value ?? '').replace(/[&<>']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', [String.fromCharCode(39)]: '&#39;' })[character] ?? character);
}

function chartPrint(titleValue: string, data: ChartDatum[] = []) {
    const max = Math.max(1, ...data.map(item => item.value));
    return `<section class='print-chart'><h2>${escapeHtml(titleValue)}</h2>${data.map(item => `<div><span>${escapeHtml(item.label)}</span><i><b style='width:${item.value / max * 100}%'></b></i><strong>${escapeHtml(item.value)}</strong></div>`).join('') || '<p>No data</p>'}</section>`;
}

function cardsFor(kind: ReportKind, report: DashboardReport): ReportCardDatum[] {
    if (kind !== 'reservation') return report.analytics.cards ?? [];
    return [
        { key: 'total_reservations', label: 'Total Reservations', value: report.kpis.total_reservations, filter_field: 'status', filter_value: '' },
        { key: 'confirmed_reservations', label: 'Confirmed Reservations', value: report.kpis.confirmed_reservations, filter_field: 'status', filter_value: 'confirmed' },
        { key: 'verified_payments', label: 'Total Verified Payments', value: Number(report.kpis.verified_payments), format: 'currency', filter_field: 'status', filter_value: 'verified' },
        { key: 'pending_reviews', label: 'Pending Deposit Reviews', value: report.kpis.pending_deposit_reviews, filter_field: 'status', filter_value: 'awaiting_review' },
    ];
}

function cardLabel(card: ReportCardDatum) {
    return card.format === 'currency' ? `${card.label} (₱)` : card.label;
}

function cardValue(card: ReportCardDatum) {
    return card.format === 'currency' ? money(card.value) : card.value.toLocaleString();
}

function printDocument(kind: ReportKind, report: DashboardReport, mode: 'summary' | 'detailed') {
    const applied = report.filters.applied;
    const generated = date(report.generated_at, true);
    const active = [
        applied.search && `Search: ${applied.search}`,
        (applied.status || applied.payment_status) && `Status: ${label(applied.status || applied.payment_status || '')}`,
        applied.guest_type && `Guest type: ${label(applied.guest_type)}`,
        applied.frequency && `Frequency: ${applied.frequency}`,
        applied.category && `Queue category: ${label(applied.category)}`,
        applied.period && `Period point: ${applied.period}`,
    ].filter(Boolean).join(' · ') || 'No category drill-down filters';
    const analytics = report.analytics;
    const cards = cardsFor(kind, report);
    const first = analytics.status ?? analytics.classification ?? analytics.distribution ?? [];
    const second = analytics.trend ?? analytics.frequency ?? [];
    const rows = report.data.map(row => `<tr>${textCells(kind, row).map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    return `<!doctype html><html><head><title>${escapeHtml(title(kind))}</title><style>
        @page{size:${mode === 'detailed' ? 'A4 landscape' : 'A4 portrait'};margin:14mm 12mm 18mm;@bottom-center{content:'Page ' counter(page) ' of ' counter(pages);font:9pt Arial;color:#66584f}}
        *{box-sizing:border-box}body{margin:0;color:#35251d;font:10pt Arial,sans-serif}header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #6f4c3a;padding-bottom:10px}header img{width:48px;height:48px;border-radius:50%}h1{font-size:20pt;margin:0}header p,.meta{margin:3px 0;color:#6f625a}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.kpis div{border:1px solid #d9cbb9;padding:9px}.kpis span{display:block;font-size:8pt;color:#71645b}.kpis b{font-size:15pt}.charts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.print-chart{border:1px solid #d9cbb9;padding:10px}.print-chart h2{font-size:11pt;margin:0 0 8px}.print-chart div{display:grid;grid-template-columns:90px 1fr 45px;gap:6px;align-items:center;margin:6px 0}.print-chart i{height:10px;background:#eee6db}.print-chart i b{display:block;height:100%;background:#79533e}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:8pt}thead{display:table-header-group}th,td{border:1px solid #cbbdac;padding:6px;vertical-align:top;text-align:left}th{background:#eee5d8}tr{break-inside:avoid}.note{margin:12px 0;padding:8px;background:#f5efe6}
    </style></head><body><header><img src='/assets/carlos-paradise-logo.jpg'><div><h1>${escapeHtml(title(kind))}</h1><p>Carlos Paradise Interactive Reports & Analytics</p></div></header>
    <p class='meta'>Period: ${escapeHtml(applied.date_label)} · Generated ${escapeHtml(generated)} (Asia/Manila)</p><p class='meta'>Applied filters: ${escapeHtml(active)}</p>
    <section class='kpis'>${cards.map(card => `<div><span>${escapeHtml(cardLabel(card))}</span><b>${escapeHtml(cardValue(card))}</b></div>`).join('')}</section>
    ${mode === 'summary' ? `<p class='note'>${escapeHtml(analytics.scope_label)}</p><div class='charts'>${chartPrint(kind === 'guest' ? 'New vs Returning Guests' : kind === 'payment' ? 'Payment / Review Status' : 'Status Distribution', first)}${chartPrint(kind === 'guest' ? 'Reservation Frequency' : 'Activity Trend', second)}</div><p class='note'>Matching detailed records: <b>${report.total}</b>. The detailed table is intentionally excluded from this summary.</p>` : `<p class='note'>Complete filtered result set: <b>${report.total}</b> records.</p><table><thead><tr>${HEADINGS[kind].map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`}
    </body></html>`;
}

const InteractiveReport = forwardRef<InteractiveReportActions, Props>(function InteractiveReport({ kind, params, setParams, onBusyChange }, ref) {
    const navigate = useNavigate();
    const tableRef = useRef<HTMLDivElement>(null);
    const applied = useMemo(() => filtersFrom(params), [params]);
    const [draft, setDraft] = useState(applied);
    const [report, setReport] = useState<DashboardReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [action, setAction] = useState<'' | 'print' | 'export'>('');
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
    const statuses = kind === 'payment' ? PAYMENT_STATUSES : kind === 'queue' ? QUEUE_STATUSES : RESERVATION_STATUSES;

    useEffect(() => setDraft(applied), [applied]);

    useEffect(() => {
        const controller = new AbortController();
        let first = true;
        const load = () => {
            if (first) setLoading(true);
            setError('');
            AdminApi.dashboardReport(kind, queryFrom(kind, applied, page), controller.signal)
                .then(value => { setReport(value); first = false; })
                .catch(cause => {
                    if (cause instanceof DOMException && cause.name === 'AbortError') return;
                    setError(cause instanceof Error ? cause.message : `Unable to load the ${title(kind).toLowerCase()}.`);
                })
                .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        };
        load();
        const timer = window.setInterval(load, 60000);
        return () => { controller.abort(); window.clearInterval(timer); };
    }, [applied, kind, page, retry]);

    const updateUrl = useCallback((filters: Filters, nextPage = 1, targetKind = kind) => {
        const next = new URLSearchParams({ tab: targetKind });
        if (filters.search) next.set('search', filters.search);
        if (filters.date_range !== 'this_month') next.set('range', filters.date_range);
        if (filters.status) next.set(targetKind === 'payment' ? 'payment_status' : 'status', filters.status);
        if (filters.period) next.set('period', filters.period);
        if (targetKind === 'guest' && filters.guest_type) next.set('guest_type', filters.guest_type);
        if (targetKind === 'guest' && filters.frequency) next.set('frequency', filters.frequency);
        if (targetKind === 'queue' && filters.category) next.set('category', filters.category);
        if (filters.card) next.set('card', filters.card);
        if (filters.date_range === 'custom') {
            if (filters.start_date) next.set('start', filters.start_date);
            if (filters.end_date) next.set('end', filters.end_date);
        }
        if (nextPage > 1) next.set('page', String(nextPage));
        setParams(next);
    }, [kind, setParams]);

    const drill = (field: 'status' | 'period' | 'guest_type' | 'frequency', value: string) => {
        const next = { ...applied, [field]: applied[field] === value ? '' : value, card: '' };
        updateUrl(next);
        window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    };

    const switchByKpi = (target: ReportKind, status: string) => {
        updateUrl({ ...applied, status, period: '', guest_type: '', frequency: '', category: '', card: '' }, 1, target);
    };

    const selectReportCard = (card: ReportCardDatum) => {
        const next = { ...applied, status: '', period: '', guest_type: '', frequency: '', category: '', card: card.key };
        (next as unknown as Record<string, string>)[card.filter_field] = card.filter_value;
        updateUrl(next);
        window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    };

    const print = useCallback(async (mode: 'summary' | 'detailed') => {
        const popup = window.open('', '_blank');
        if (!popup) { setError('Printing was blocked. Allow pop-ups and try again.'); return; }
        popup.opener = null;
        popup.document.write('<p>Preparing complete report…</p>');
        setAction('print'); onBusyChange(true);
        try {
            const complete = await AdminApi.dashboardReportPrint(kind, queryFrom(kind, applied));
            popup.document.open(); popup.document.write(printDocument(kind, complete, mode)); popup.document.close();
            popup.focus(); window.setTimeout(() => popup.print(), 150);
        } catch (cause) {
            popup.close(); setError(cause instanceof Error ? cause.message : 'Unable to prepare the report.');
        } finally { setAction(''); onBusyChange(false); }
    }, [applied, kind, onBusyChange]);

    const exportCsv = useCallback(async () => {
        setAction('export'); onBusyChange(true);
        try {
            const { blob, filename } = await AdminApi.exportDashboardReport(kind, queryFrom(kind, applied));
            const url = URL.createObjectURL(blob); const link = document.createElement('a');
            link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export the report.'); }
        finally { setAction(''); onBusyChange(false); }
    }, [applied, kind, onBusyChange]);

    useImperativeHandle(ref, () => ({ print, exportCsv, busy: action !== '' }), [action, exportCsv, print]);

    const openReservation = (row: Record<string, unknown>) => {
        const id = Number(row.id ?? row.reservation_id ?? row.associated_reservation_id);
        if (!id) return;
        const returnTo = `/admin/reports?${params.toString()}`;
        navigate(`/admin/reservations/${id}?returnTo=${encodeURIComponent(returnTo)}`);
    };

    const firstChart = report?.analytics.status ?? report?.analytics.classification ?? report?.analytics.distribution ?? [];
    const secondChart = report?.analytics.trend ?? report?.analytics.frequency ?? [];
    const statusTitle = kind === 'reservation' ? 'Reservation Status' : kind === 'guest' ? 'New vs Returning Guests' : kind === 'payment' ? 'Payment / Review Status' : 'Queue Status';
    const trendTitle = kind === 'reservation' ? 'Reservation Volume' : kind === 'guest' ? 'Reservation Frequency' : kind === 'payment' ? 'Verified Payment Amount' : 'Queue Activity';
    const chartStatusSelection = kind === 'guest' ? '' : applied.status;
    const reportCards = report ? cardsFor(kind, report) : [];
    const selectedCard = reportCards.find(card => card.key === applied.card);
    const tags = [
        applied.search && { key: 'search', text: `Search: ${applied.search}` },
        applied.date_range !== 'this_month' && { key: 'date_range', text: report?.filters.applied.date_label ?? label(applied.date_range) },
        applied.card && { key: 'card', text: selectedCard?.label ?? label(applied.card) },
        !applied.card && applied.status && { key: 'status', text: `Status: ${label(applied.status)}` },
        applied.period && { key: 'period', text: `Period: ${applied.period}` },
        !applied.card && applied.guest_type && { key: 'guest_type', text: `Guest: ${label(applied.guest_type)}` },
        !applied.card && applied.frequency && { key: 'frequency', text: `Frequency: ${applied.frequency}` },
        !applied.card && applied.category && { key: 'category', text: `Queue: ${label(applied.category)}` },
    ].filter(Boolean) as Array<{ key: string; text: string }>;

    const reset = { search: '', date_range: 'this_month', status: '', start_date: '', end_date: '', period: '', guest_type: '', frequency: '', category: '', card: '' };
    const clearTag = (key: string) => {
        const next = { ...applied };
        if (key === 'date_range') { next.date_range = 'this_month'; next.start_date = ''; next.end_date = ''; }
        else if (key === 'card') { next.card = ''; next.status = ''; next.guest_type = ''; next.frequency = ''; next.category = ''; }
        else (next as unknown as Record<string, string>)[key] = '';
        updateUrl(next);
    };

    return <section className='interactive-report' aria-labelledby={`${kind}-report-title`}>
        <form className='reservation-report-filters' onSubmit={event => {
            event.preventDefault();
            if (draft.date_range === 'custom' && (!draft.start_date || !draft.end_date)) {
                setError('Choose both a start and end date for the custom range.'); return;
            }
            updateUrl({ ...draft, period: '', guest_type: '', frequency: '', category: '', card: '' });
        }}>
            <label className='report-search'><span>Search</span><input value={draft.search} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder={kind === 'payment' ? 'Reservation or payment reference' : kind === 'queue' ? 'Reservation reference' : 'Guest or reservation reference'} /></label>
            <label><span>Date Range</span><select value={draft.date_range} onChange={event => setDraft(current => ({ ...current, date_range: event.target.value }))}>{DATE_RANGES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            {draft.date_range === 'custom' && <>
                <label><span>Start Date</span><input type='date' value={draft.start_date} onChange={event => setDraft(current => ({ ...current, start_date: event.target.value }))} /></label>
                <label><span>End Date</span><input type='date' min={draft.start_date || undefined} value={draft.end_date} onChange={event => setDraft(current => ({ ...current, end_date: event.target.value }))} /></label>
            </>}
            {kind !== 'guest' && <label><span>{kind === 'payment' ? 'Review Status' : 'Status'}</span><select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}><option value=''>All Statuses</option>{statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>}
            <button className='report-apply' type='submit'>Apply Filters</button>
            <button className='report-reset' type='button' onClick={() => updateUrl(reset)}>Reset All</button>
        </form>

        {kind === 'reservation' ? report?.kpis && <section className='report-kpis' aria-label='Report scope key performance indicators'>
            <p>{report.kpis.scope_label}</p>
            <div>
                <button type='button' onClick={() => switchByKpi('reservation', '')}><span>Total Reservations</span><b>{report.kpis.total_reservations.toLocaleString()}</b><small>Open all reservation statuses</small></button>
                <button type='button' onClick={() => switchByKpi('reservation', 'confirmed')}><span>Confirmed Reservations</span><b>{report.kpis.confirmed_reservations.toLocaleString()}</b><small>Open confirmed reservations</small></button>
                <button type='button' onClick={() => switchByKpi('payment', 'verified')}><span>Total Verified Payments</span><b>{money(report.kpis.verified_payments)}</b><small>Open verified payments</small></button>
                <button type='button' onClick={() => switchByKpi('payment', 'awaiting_review')}><span>Pending Deposit Reviews</span><b>{report.kpis.pending_deposit_reviews.toLocaleString()}</b><small>Open submissions awaiting review</small></button>
            </div>
        </section> : <section className='report-kpis' aria-label={`${title(kind)} totals`}>
            <p><strong>Totals follow the search and date range. Status filters apply to the table.</strong></p>
            {loading ? <div className='report-kpi-state' role='status'>Loading totals…</div> :
                error ? <div className='report-kpi-state'>Totals unavailable. Retry below.</div> :
                reportCards.length === 0 ? <div className='report-kpi-state'>No totals are available for this scope.</div> :
                <div>{reportCards.map(card => <button type='button' key={card.key} className={applied.card === card.key ? 'selected' : ''}
                    aria-pressed={applied.card === card.key} onClick={() => selectReportCard(card)}>
                    <span>{cardLabel(card)}</span><b>{cardValue(card)}</b><small>Filter matching table</small>
                </button>)}</div>}
        </section>}

        <div className='reservation-report-heading'>
            <div><h2 id={`${kind}-report-title`}>{title(kind)}</h2><p>{report ? `${report.total.toLocaleString()} matching ${kind === 'guest' ? 'guests' : 'records'} · ${report.filters.applied.date_label}` : 'Loading report summary…'}</p></div>
            <div className='report-freshness'>{action ? (action === 'print' ? 'Preparing print…' : 'Preparing CSV…') : report ? `Updated ${date(report.generated_at, true)}` : ''}<small>Asia/Manila · refreshes every minute</small></div>
        </div>

        {tags.length > 0 && <div className='report-filter-tags' aria-label='Applied filters'>{tags.map(tag => <button type='button' key={tag.key} onClick={() => clearTag(tag.key)} aria-label={`Remove ${tag.text} filter`}>{tag.text}<span aria-hidden='true'>×</span></button>)}<button type='button' className='clear-all' onClick={() => updateUrl(reset)}>Reset All</button></div>}

        {error && <div className='report-error' role='alert'><span>{error}</span><button type='button' onClick={() => setRetry(value => value + 1)}>Retry</button></div>}

        {report && <><p className='chart-scope'>{report.analytics.scope_label}. Chart totals remain based on this scope while drill-down filters the details below.</p>
            <div className='report-charts'>
                {kind === 'queue'
                    ? <BarChart title={statusTitle} data={firstChart} selected={chartStatusSelection} horizontal onSelect={item => drill('status', item.key)} />
                    : <DonutChart title={statusTitle} data={firstChart} selected={kind === 'guest' ? applied.guest_type : chartStatusSelection} onSelect={item => drill(kind === 'guest' ? 'guest_type' : 'status', item.key)} />}
                {kind === 'guest'
                    ? <BarChart title={trendTitle} data={secondChart} selected={applied.frequency} onSelect={item => drill('frequency', item.key)} />
                    : <TrendChart title={trendTitle} data={secondChart} selected={applied.period} currency={kind === 'payment'} onSelect={item => drill('period', item.key)} />}
            </div></>}

        <div ref={tableRef} className='report-table-anchor'>
            {loading ? <div className='report-state' role='status'>Loading {title(kind).toLowerCase()}…</div> :
                !report || report.data.length === 0 ? <div className='report-state'><strong>No matching records</strong><span>Try removing a drill-down tag or changing the base scope.</span></div> :
                <div className='reservation-report-table-scroll'><table className={`reservation-report-table dashboard-table dashboard-table-${kind}`}>
                    <thead><tr>{HEADINGS[kind].map(heading => <th key={heading}>{heading}</th>)}</tr></thead>
                    <tbody>{report.data.map((row, index) => {
                        const id = Number(row.id ?? row.reservation_id ?? row.associated_reservation_id);
                        return <tr key={String(row.payment_id ?? row.user_id ?? id ?? index)} role={id ? 'link' : undefined} tabIndex={id ? 0 : undefined}
                            aria-label={id ? `Open reservation ${row.booking_reference ?? row.associated_booking_reference}` : undefined}
                            onClick={() => openReservation(row)} onKeyDown={event => { if (event.key === 'Enter') openReservation(row); }}>
                            {textCells(kind, row).map((cell, cellIndex) => <td key={HEADINGS[kind][cellIndex]}>
                                {cellIndex === 0 || (kind === 'guest' && cellIndex === 3) ? <strong>{cell}</strong> : ((kind === 'reservation' && cellIndex === 3) || (kind === 'payment' && cellIndex === 4) || (kind === 'queue' && cellIndex === 3)) ? <span className={`report-status report-status-${row.status ?? row.review_status}`}>{cell}</span> : cell}
                            </td>)}
                        </tr>;
                    })}</tbody>
                </table></div>}
        </div>

        {report && report.total > 0 && <footer className='reservation-report-footer'>
            <span>Showing {report.from ?? 0}–{report.to ?? 0} of {report.total}</span>
            <nav aria-label={`${title(kind)} pages`}><button type='button' disabled={page <= 1 || loading} onClick={() => updateUrl(applied, page - 1)}>Previous</button><span aria-current='page'>Page {page} of {report.last_page ?? 1}</span><button type='button' disabled={page >= (report.last_page ?? 1) || loading} onClick={() => updateUrl(applied, page + 1)}>Next</button></nav>
        </footer>}
    </section>;
});

export default InteractiveReport;
