<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

class ReportKpis
{
    public function calculate(array $filters): array
    {
        $reservations = DB::table('reservations as reservation')->where('reservation.villa_id', 1);
        $this->reservationSearch($reservations, $filters['search'] ?? '');
        if (($filters['start_date'] ?? null) !== null) {
            $reservations->whereDate('reservation.check_in_date', '>=', $filters['start_date']);
        }
        if (($filters['end_date'] ?? null) !== null) {
            $reservations->whereDate('reservation.check_in_date', '<=', $filters['end_date']);
        }

        $payments = DB::table('payments as payment')
            ->join('reservations as reservation', 'reservation.id', '=', 'payment.reservation_id')
            ->where('reservation.villa_id', 1);
        $this->paymentSearch($payments, $filters['search'] ?? '');
        $eventDate = DB::raw('COALESCE((SELECT MAX(reviewed_at) FROM payment_reviews WHERE payment_id = payment.id), payment.submitted_at)');
        if (($filters['start_date'] ?? null) !== null) {
            $payments->whereDate($eventDate, '>=', $filters['start_date']);
        }
        if (($filters['end_date'] ?? null) !== null) {
            $payments->whereDate($eventDate, '<=', $filters['end_date']);
        }

        return [
            'scope_label' => 'Search and selected period; reservations use check-in date and payments use approval/submission date',
            'total_reservations' => (clone $reservations)->count('reservation.id'),
            'confirmed_reservations' => (clone $reservations)->where('reservation.status', 'confirmed')->count('reservation.id'),
            'verified_payments' => number_format((float) (clone $payments)->where('payment.status', 'approved')->sum('payment.amount'), 2, '.', ''),
            'pending_deposit_reviews' => (clone $payments)->where('payment.status', 'submitted')->count('payment.id'),
        ];
    }

    private function reservationSearch(Builder $query, string $search): void
    {
        if ($search === '') return;
        $pattern = '%'.$search.'%';
        $query->where(function (Builder $nested) use ($pattern) {
            $nested->whereLike('reservation.booking_reference', $pattern, caseSensitive: false)
                ->orWhereLike('reservation.contact_name', $pattern, caseSensitive: false)
                ->orWhereLike('reservation.contact_email', $pattern, caseSensitive: false);
        });
    }

    private function paymentSearch(Builder $query, string $search): void
    {
        if ($search === '') return;
        $pattern = '%'.$search.'%';
        $query->where(function (Builder $nested) use ($pattern) {
            $nested->whereLike('reservation.booking_reference', $pattern, caseSensitive: false)
                ->orWhereLike('payment.reference_number', $pattern, caseSensitive: false);
        });
    }
}
