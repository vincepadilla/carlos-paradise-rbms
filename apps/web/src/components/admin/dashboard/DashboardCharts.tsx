import type { KeyboardEvent } from 'react';

import type { DashboardSummary } from '../../../types/admin';
import { StaffLink as Link, useStaffNavigate as useNavigate } from '../StaffRouting';

const COLORS = ['#6f4c3a', '#b9855d', '#d7b98f', '#58705a', '#9a5d54', '#776a8b', '#b59e6d', '#496b78', '#8b715d', '#a78c68'];

function label(value: string) {
    return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function activate(event: KeyboardEvent<SVGCircleElement>, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        action();
    }
}

export default function DashboardCharts({ summary, error, onRetry }: {
    summary: DashboardSummary | null;
    error: string;
    onRetry: () => void;
}) {
    const navigate = useNavigate();

    if (!summary && error) return <div className='dashboard-chart-state dashboard-chart-error' role='alert'>
        <span>{error}</span><button type='button' onClick={onRetry}>Retry charts</button>
    </div>;
    if (!summary) return <div className='dashboard-chart-state' role='status'>Loading reservation charts...</div>;

    const total = summary.reservation_statuses.reduce((sum, item) => sum + item.count, 0);
    const maxMonth = Math.max(1, ...summary.reservations_per_month.map(item => item.count));

    return <section className='dashboard-charts' aria-label='Reservation analytics'>
        <article className='dashboard-chart-card'>
            <header><div><h2>Reservation Status</h2><p>{summary.status_period_label}</p></div><span>{total.toLocaleString()} total</span></header>
            {total === 0 ? <div className='dashboard-chart-empty'>No reservation status data</div> : <div className='dashboard-donut-layout'>
                <svg viewBox='0 0 120 120' className='dashboard-donut' role='img' aria-label='Reservation status counts and percentages'>
                    <circle cx='60' cy='60' r='42' fill='none' stroke='#eee6db' strokeWidth='18' />
                    {summary.reservation_statuses.map((item, index) => {
                        const length = item.count / total * 263.89;
                        const start = summary.reservation_statuses.slice(0, index)
                            .reduce((sum, segment) => sum + segment.count / total * 263.89, 0);
                        const destination = `/admin/reservations?status=${encodeURIComponent(item.key)}`;
                        return <circle key={item.key} cx='60' cy='60' r='42' fill='none' stroke={COLORS[index % COLORS.length]}
                            strokeWidth='18' strokeDasharray={`${length} ${263.89 - length}`} strokeDashoffset={-start}
                            transform='rotate(-90 60 60)' role='link' tabIndex={0}
                            aria-label={`${label(item.key)}: ${item.count}, ${item.percentage} percent. Open filtered reservations.`}
                            onClick={() => navigate(destination)} onKeyDown={event => activate(event, () => navigate(destination))}>
                            <title>{label(item.key)}: {item.count} ({item.percentage}%)</title>
                        </circle>;
                    })}
                    <text x='60' y='58' textAnchor='middle' className='dashboard-donut-total'>{total}</text>
                    <text x='60' y='72' textAnchor='middle' className='dashboard-donut-caption'>reservations</text>
                </svg>
                <div className='dashboard-chart-legend'>
                    {summary.reservation_statuses.map((item, index) => <Link key={item.key} to={`/admin/reservations?status=${encodeURIComponent(item.key)}`}>
                        <i style={{ background: COLORS[index % COLORS.length] }} /><span>{label(item.key)}</span><b>{item.count}</b><small>{item.percentage}%</small>
                    </Link>)}
                </div>
            </div>}
        </article>

        <article className='dashboard-chart-card'>
            <header><div><h2>Reservations per Month</h2><p>{summary.monthly_period_label}</p></div><span>Check-in month</span></header>
            {summary.reservations_per_month.every(item => item.count === 0) ? <div className='dashboard-chart-empty'>No check-ins in this reporting period</div> : <div className='dashboard-month-bars' role='list' aria-label='Reservation counts by check-in month'>
                {summary.reservations_per_month.map(item => {
                    const date = new Date(`${item.month}-01T00:00:00+08:00`);
                    const month = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short' }).format(date);
                    return <Link role='listitem' key={item.month} to={`/admin/reservations?check_in_month=${item.month}`}
                        aria-label={`${month}: ${item.count} reservations. Open filtered reservations.`}>
                        <b>{item.count}</b><i><em style={{ height: `${item.count === 0 ? 0 : Math.max(6, item.count / maxMonth * 100)}%` }} /></i><span>{month}</span>
                        <small role='tooltip'>{item.count} reservation{item.count === 1 ? '' : 's'}</small>
                    </Link>;
                })}
            </div>}
        </article>
    </section>;
}
