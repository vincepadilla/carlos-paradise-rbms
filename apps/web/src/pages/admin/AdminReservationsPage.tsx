import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import AdminPagination from '../../components/admin/AdminPagination';
import AdminResource from '../../components/admin/AdminResource';
import AdminReservationTable from '../../components/admin/AdminReservationTable';
import DepositReviewList from '../../components/admin/payment-review/DepositReviewList';
import { statusLabel } from '../../api';
import { AdminApi } from '../../services/AdminApi';
import '../../components/admin/payment-review/payment-review.css';

type ReservationTab = 'all' | 'deposit-review' | 'queue-management';

function tabFrom(value: string | null): ReservationTab {
    return value === 'deposit-review' || value === 'queue-management' ? value : 'all';
}

function typeLabel(value: string): string {
    return value === 'overnight' ? 'Overnight Stay' : value === 'day_tour' ? 'Day Tour' : value.replaceAll('_', ' ');
}

function AllReservations() {
    const [params, setParams] = useSearchParams();
    const requestedPage = Number(params.get('page') ?? 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const search = params.get('search')?.trim() ?? '';
    const status = params.get('status') ?? '';
    const type = params.get('type') ?? '';
    const load = useCallback(
        (signal: AbortSignal) => AdminApi.reservationList(page, search, status, type, signal),
        [page, search, status, type],
    );

    const setFilter = (key: 'search' | 'status' | 'type', value: string) => {
        const next = new URLSearchParams(params);
        next.delete('tab');
        next.delete('page');
        if (value) next.set(key, value);
        else next.delete(key);
        setParams(next, { replace: key === 'search' });
    };

    return <AdminResource load={load} showRefresh={false} keepPreviousData>{data => <>
        <div className='admin-reservation-toolbar' role='search'>
            <label className='admin-reservation-search'>
                <span className='sr-only'>Search reservations</span>
                <input
                    type='search'
                    value={search}
                    placeholder='Search guest or reservation ID'
                    onChange={event => setFilter('search', event.target.value)}
                />
            </label>
            <label>
                <span className='sr-only'>Filter by status</span>
                <select value={status} onChange={event => setFilter('status', event.target.value)}>
                    <option value=''>All Statuses</option>
                    {data.filters.statuses.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
            </label>
            <label>
                <span className='sr-only'>Filter by reservation type</span>
                <select value={type} onChange={event => setFilter('type', event.target.value)}>
                    <option value=''>All Types</option>
                    {data.filters.types.map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}
                </select>
            </label>
        </div>
        <AdminReservationTable reservations={data.data} total={data.total} />
        {data.last_page > 1 && <AdminPagination
            page={data.current_page}
            lastPage={data.last_page}
            total={data.total}
            onChange={value => {
                const next = new URLSearchParams(params);
                if (value > 1) next.set('page', String(value));
                else next.delete('page');
                setParams(next);
            }}
        />}
    </>}</AdminResource>;
}

function QueueManagement() {
    return <AdminResource load={AdminApi.reservations} showRefresh={false}>{({ reservations }) => {
        const queued = reservations
            .filter(item => ['pending', 'queued', 'awaiting_deposit'].includes(item.status))
            .sort((left, right) => (left.queue_position ?? Infinity) - (right.queue_position ?? Infinity) || left.id - right.id);
        return <AdminReservationTable queue reservations={queued} total={queued.length} />;
    }}</AdminResource>;
}

export default function AdminReservationsPage() {
    const [params] = useSearchParams();
    const tab = tabFrom(params.get('tab'));

    return <section className='admin-reservations-page' aria-labelledby='admin-reservations-title'>
        <header className='admin-reservations-header'>
            <div>
                <h1 id='admin-reservations-title'>Reservations</h1>
                <p>Manage the complete reservation workflow from one place.</p>
            </div>
            <button
                type='button'
                className='admin-make-reservation'
                onClick={() => window.alert('Soon to be implemented.')}
            >
                Make a Reservation
            </button>
        </header>
        <nav className='admin-reservation-tabs' aria-label='Reservation views'>
            <Link to='/admin/reservations' aria-current={tab === 'all' ? 'page' : undefined}>All Reservations</Link>
            <Link to='/admin/reservations?tab=deposit-review' aria-current={tab === 'deposit-review' ? 'page' : undefined}>Deposit Review</Link>
            <Link to='/admin/reservations?tab=queue-management' aria-current={tab === 'queue-management' ? 'page' : undefined}>Queue Management</Link>
        </nav>
        {tab === 'deposit-review' ? <DepositReviewList /> : tab === 'queue-management' ? <QueueManagement /> : <AllReservations />}
    </section>;
}
