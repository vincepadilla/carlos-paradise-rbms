import { useStaffNavigate as useNavigate } from "./StaffRouting";

import { dateTime, money, statusLabel } from '../../api';
import type { AdminReservation } from '../../types/admin';
import StatusBadge from './StatusBadge';

export const reservationScope = 'Based on the latest 500 reservations returned by the reservation API. All times are Asia/Manila.';

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila',
});

function dateRange(start: string, end: string): string {
    const startText = dateFormatter.format(new Date(start));
    const endText = dateFormatter.format(new Date(end));
    return startText === endText ? startText : `${startText} – ${endText}`;
}

function typeLabel(type: string): string {
    return type === 'overnight' ? 'Overnight Stay' : type === 'day_tour' ? 'Day Tour' : type.replaceAll('_', ' ');
}

function valueLabel(value: string): string {
    return value.split('_').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

function amount(value: string | number | null | undefined): string {
    return value === null || value === undefined || value === '' ? '—' : money(value);
}

function ReservationRow({ reservation, queue }: { reservation: AdminReservation; queue: boolean }) {
    const navigate = useNavigate();
    const destination = `/admin/reservations/${reservation.id}`;
    const latestPayment = reservation.payments?.[0];
    const hasGuestCounts = reservation.adults !== null && reservation.adults !== undefined
        && reservation.children !== null && reservation.children !== undefined;
    const guestCount = hasGuestCounts ? Number(reservation.adults) + Number(reservation.children) : null;
    const open = () => navigate(destination);

    return <tr
        tabIndex={0}
        aria-label={`Open reservation ${reservation.reference}`}
        onClick={event => {
            if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea')) return;
            open();
        }}
        onKeyDown={event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                open();
            }
        }}
    >
        <td><strong className='admin-reservation-reference'>{reservation.reference || '—'}</strong></td>
        <td><strong>{reservation.contact_name || '—'}</strong><small>{reservation.contact_email || '—'}</small></td>
        <td><span>{dateRange(reservation.starts_at, reservation.ends_at)}</span><small>{typeLabel(reservation.type)}</small></td>
        {queue ? <>
            <td>{statusLabel(reservation.status)}</td>
            <td><span>Position: {reservation.queue_position ?? '—'}</span><small>Opportunity: {reservation.opportunity?.status ?? '—'}</small></td>
            <td>{reservation.deadline ? dateTime(reservation.deadline) : '—'}</td>
        </> : <>
            <td><span>{guestCount !== null && Number.isFinite(guestCount) ? guestCount : '—'}</span><small>{reservation.adults ?? '—'} adults · {reservation.children ?? '—'} children</small></td>
            <td><span>{latestPayment?.status ? valueLabel(latestPayment.status) : '—'}</span><small>{amount(reservation.deposit_paid)} paid / {amount(reservation.deposit)} required</small></td>
            <td><StatusBadge status={reservation.status} /></td>
        </>}
    </tr>;
}

export default function AdminReservationTable({ reservations, total = reservations.length, queue = false }: {
    reservations: AdminReservation[];
    total?: number;
    queue?: boolean;
}) {
    return <section className='admin-reservation-card' aria-label={queue ? 'Queue Management' : 'Reservations'}>
        <header className='admin-reservation-card-header'>
            <h2>{queue ? 'Queue Management' : 'Reservations'}</h2>
            <span>{total} {total === 1 ? 'reservation' : 'reservations'}</span>
        </header>
        {reservations.length ? <div className='admin-table-scroll'><table className='admin-table admin-reservation-table'>
            <thead><tr>
                <th scope='col'>Reservation ID</th>
                <th scope='col'>Guest</th>
                <th scope='col'>Requested Date</th>
                {queue ? <>
                    <th scope='col'>Status</th>
                    <th scope='col'>Queue / Opportunity</th>
                    <th scope='col'>Deadline</th>
                </> : <>
                    <th scope='col'>Guests</th>
                    <th scope='col'>Deposit</th>
                    <th scope='col'>Status</th>
                </>}
            </tr></thead>
            <tbody>{reservations.map(reservation => <ReservationRow key={reservation.id} reservation={reservation} queue={queue} />)}</tbody>
        </table></div> : <p className='admin-reservations-empty'>No reservations match the current search and filters.</p>}
    </section>;
}
