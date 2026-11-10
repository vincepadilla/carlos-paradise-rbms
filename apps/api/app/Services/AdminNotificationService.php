<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class AdminNotificationService
{
    public function create(string $eventKey, string $type, string $title, string $description, ?int $reservationId, string $destination, CarbonImmutable|string|null $occurredAt = null): void
    {
        $now = CarbonImmutable::now('Asia/Manila');
        $occurred = $occurredAt ? CarbonImmutable::parse($occurredAt, 'Asia/Manila') : $now;
        DB::table('admin_notifications')->insertOrIgnore([
            'event_key' => $eventKey, 'type' => $type, 'title' => $title,
            'description' => $description, 'reservation_id' => $reservationId,
            'destination' => $destination, 'occurred_at' => $occurred->toIso8601String(),
            'created_at' => $now->format('Y-m-d H:i:s'), 'updated_at' => $now->format('Y-m-d H:i:s'),
        ]);

        $notificationId = DB::table('admin_notifications')->where('event_key', $eventKey)->value('id');
        if (! $notificationId) {
            return;
        }
        $staffIds = DB::table('users as u')->join('roles as r', 'r.id', '=', 'u.role_id')
            ->where('u.is_active', true)->whereIn('r.name', ['admin', 'owner'])->pluck('u.id');
        foreach ($staffIds as $userId) {
            DB::table('admin_notification_recipients')->insertOrIgnore([
                'notification_id' => $notificationId, 'user_id' => $userId, 'read_at' => null,
                'created_at' => $now->format('Y-m-d H:i:s'), 'updated_at' => $now->format('Y-m-d H:i:s'),
            ]);
        }
    }

    public function reservationCreated(object $reservation): void
    {
        $dates = $this->stayDates($reservation);
        $this->create('reservation:'.$reservation->id.':created', 'reservation_request', 'New reservation request',
            $reservation->booking_reference.' was submitted for '.$dates.'.', $reservation->id,
            '/admin/reservations/'.$reservation->id, $reservation->requested_at);
        if ($reservation->status === 'queued') {
            $this->create('reservation:'.$reservation->id.':queued', 'queue_waiting', 'Overlapping request waiting in queue',
                $reservation->booking_reference.' overlaps an active request for '.$dates.' and is waiting in the queue.',
                $reservation->id, '/admin/reservations?tab=queue-management&reservation='.$reservation->id, $reservation->requested_at);
        }
    }

    public function depositDeadlineActivated(object $reservation, CarbonImmutable $deadline): void
    {
        $this->create('reservation:'.$reservation->id.':deposit-deadline:'.$deadline->getTimestamp(), 'deposit_deadline',
            'Deposit deadline activated', $reservation->booking_reference.' can submit a deposit until '.
            $deadline->setTimezone('Asia/Manila')->format('M j, Y, g:i A').' (Asia/Manila).',
            $reservation->id, '/admin/reservations/'.$reservation->id);
    }

    public function paymentSubmitted(object $reservation, int $paymentId, string $amount): void
    {
        $partial = (float) $amount < (float) $reservation->required_deposit;
        $formatted = 'PHP '.number_format((float) $amount, 2);
        $required = 'PHP '.number_format((float) $reservation->required_deposit, 2);
        $this->create('payment:'.$paymentId.':submitted', $partial ? 'partial_deposit' : 'payment_proof',
            $partial ? 'Partial deposit submitted' : 'Payment proof submitted for review',
            $partial ? $reservation->booking_reference.' submitted '.$formatted.' of the '.$required.' required deposit.'
                : $reservation->booking_reference.' submitted payment proof for '.$formatted.' and is ready for review.',
            $reservation->id, '/admin/reservations/'.$reservation->id.'/payment-review');
    }

    public function syncOngoingStays(): void
    {
        $now = CarbonImmutable::now('Asia/Manila');
        $stays = DB::table('reservations')->where('status', 'confirmed')
            ->where('starts_at', '<=', $now->toIso8601String())->where('ends_at', '>', $now->toIso8601String())->get();
        foreach ($stays as $reservation) {
            $this->create('reservation:'.$reservation->id.':ongoing', 'ongoing_stay', 'Reservation entered an ongoing stay',
                $reservation->booking_reference.' is now in progress and ends '.
                CarbonImmutable::parse($reservation->ends_at)->setTimezone('Asia/Manila')->format('M j, Y, g:i A').'.',
                $reservation->id, '/admin/reservations/'.$reservation->id, $reservation->starts_at);
        }
    }

    private function stayDates(object $reservation): string
    {
        $start = CarbonImmutable::parse($reservation->starts_at)->setTimezone('Asia/Manila');
        $end = CarbonImmutable::parse($reservation->ends_at)->setTimezone('Asia/Manila');

        return $start->isSameDay($end) ? $start->format('M j, Y') : $start->format('M j').'–'.$end->format('M j, Y');
    }
}
