import type { DashboardSummary } from '../../../types/admin';
import { StaffLink as Link } from '../StaffRouting';

const cards: Array<{
    key: keyof Pick<DashboardSummary, 'total_reservations' | 'total_guests' | 'payments_to_review' | 'waiting_requests'>;
    label: string;
    description: string;
    to: string;
}> = [
    { key: 'total_reservations', label: 'Total Reservations', description: 'View all reservations', to: '/admin/reservations' },
    { key: 'total_guests', label: 'Total Guests', description: 'View registered guests', to: '/admin/guests' },
    { key: 'payments_to_review', label: 'Payments to Review', description: 'Review awaiting deposits', to: '/admin/reservations?tab=deposit-review&status=awaiting_review' },
    { key: 'waiting_requests', label: 'Waiting Requests', description: 'View waiting queue', to: '/admin/reservations?tab=queue-management&queue_status=waiting' },
];

export default function DashboardSummaryCards({ summary, error, onRetry }: {
    summary: DashboardSummary | null;
    error: string;
    onRetry: () => void;
}) {
    if (error && !summary) {
        return <div className='dashboard-summary-error' role='alert'>
            <span>{error}</span>
            <button type='button' onClick={onRetry}>Retry totals</button>
        </div>;
    }

    return <section className='dashboard-summary-grid' aria-label='Dashboard totals' aria-busy={!summary}>
        {cards.map(card => summary ? (
            <Link key={card.key} className='dashboard-summary-card' to={card.to}>
                <span>{card.label}</span>
                <strong>{summary[card.key].toLocaleString()}</strong>
                <small>{card.description}</small>
            </Link>
        ) : (
            <div key={card.key} className='dashboard-summary-card dashboard-summary-loading' role='status'>
                <span>{card.label}</span>
                <strong aria-hidden='true'>-</strong>
                <small>Loading total...</small>
            </div>
        ))}
    </section>;
}
