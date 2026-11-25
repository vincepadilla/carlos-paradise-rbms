<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\ReservationPricing;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminGuestsController extends Controller
{
    private function guests(): Builder
    {
        return User::query()
            ->whereHas('role', fn (Builder $query) => $query->where('name', 'guest'))
            ->select([
                'users.id', 'users.name', 'users.email', 'users.phone', 'users.address', 'users.is_active',
                'users.email_verified_at', 'users.created_at', 'users.updated_at',
            ])
            ->addSelect([
                'latest_booking_reference' => DB::table('reservations')
                    ->select('booking_reference')
                    ->whereColumn('reservations.user_id', 'users.id')
                    ->orderByDesc('requested_at')
                    ->orderByDesc('id')
                    ->limit(1),
            ]);
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'search' => ['sometimes', 'string', 'max:100'],
        ]);

        $search = trim($validated['search'] ?? '');
        $guests = $this->guests();

        if ($search !== '') {
            $pattern = '%'.$search.'%';
            $guests->where(function (Builder $query) use ($pattern): void {
                $query->whereLike('users.name', $pattern, caseSensitive: false)
                    ->orWhereLike('users.phone', $pattern, caseSensitive: false)
                    ->orWhereLike('users.email', $pattern, caseSensitive: false)
                    ->orWhereExists(function ($reservations) use ($pattern): void {
                        $reservations->selectRaw('1')
                            ->from('reservations')
                            ->whereColumn('reservations.user_id', 'users.id')
                            ->where(function ($reservation) use ($pattern): void {
                                $reservation->whereLike('reservations.contact_name', $pattern, caseSensitive: false)
                                    ->orWhereLike('reservations.contact_phone', $pattern, caseSensitive: false)
                                    ->orWhereLike('reservations.contact_email', $pattern, caseSensitive: false)
                                    ->orWhereLike('reservations.booking_reference', $pattern, caseSensitive: false);
                            });
                    });
            });
        }

        return response()->json($guests->orderBy('users.id')->paginate(25)->withQueryString());
    }

    public function show(int $guest): JsonResponse
    {
        $profile = $this->guests()->findOrFail($guest);
        $records = DB::table('reservations')
            ->where('user_id', $profile->id)
            ->select([
                'id', 'booking_reference', 'status', 'contact_address', 'requested_at',
                'starts_at', 'ends_at', 'adults', 'children', 'required_deposit',
            ])
            ->orderByRaw(
                'CASE WHEN status = ? AND starts_at <= ? AND ends_at > ? THEN 0 ELSE 1 END',
                ['confirmed', now(), now()]
            )
            ->orderByDesc('requested_at')
            ->orderByDesc('id')
            ->get();

        $paymentRecords = $records->isEmpty()
            ? collect()
            : DB::table('payments as p')
                ->join('reservations as r', 'r.id', '=', 'p.reservation_id')
                ->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
                ->whereIn('p.reservation_id', $records->pluck('id'))
                ->orderByDesc('p.submitted_at')
                ->orderByDesc('p.id')
                ->get([
                    'p.id', 'p.reservation_id', 'r.booking_reference', 'p.amount', 'p.status',
                    'p.payment_kind', 'p.reference_number', 'p.payment_date', 'p.submitted_at',
                    'm.name as method',
                ]);
        $payments = $paymentRecords->groupBy('reservation_id');

        $reservations = $records->map(function ($reservation) use ($payments): array {
            $reservationPayments = $payments->get($reservation->id, collect());
            $sum = fn (string $status): int => $reservationPayments
                ->where('status', $status)
                ->sum(fn ($payment): int => ReservationPricing::cents($payment->amount));
            $approved = $sum('approved');
            $submitted = $sum('submitted');
            $rejected = $sum('rejected');
            $required = ReservationPricing::cents($reservation->required_deposit);

            if ($approved > 0) {
                $paymentStatus = $approved >= $required ? 'Verified' : 'Partially verified';
                $paymentAmount = $approved;
                $paymentAmountKind = 'verified';
            } elseif ($submitted > 0) {
                $paymentStatus = 'Awaiting review';
                $paymentAmount = $submitted;
                $paymentAmountKind = 'submitted';
            } elseif ($rejected > 0) {
                $paymentStatus = 'Rejected';
                $paymentAmount = $rejected;
                $paymentAmountKind = 'rejected';
            } else {
                $paymentStatus = $required === 0 ? 'No deposit required' : 'Not yet paid';
                $paymentAmount = 0;
                $paymentAmountKind = null;
            }

            return [
                'id' => $reservation->id,
                'booking_reference' => $reservation->booking_reference,
                'status' => $reservation->status,
                'contact_address' => $reservation->contact_address,
                'requested_at' => CarbonImmutable::parse($reservation->requested_at, 'Asia/Manila')->toIso8601String(),
                'starts_at' => CarbonImmutable::parse($reservation->starts_at, 'Asia/Manila')->toIso8601String(),
                'ends_at' => CarbonImmutable::parse($reservation->ends_at, 'Asia/Manila')->toIso8601String(),
                'adults' => (int) $reservation->adults,
                'children' => (int) $reservation->children,
                'required_deposit' => number_format($required / 100, 2, '.', ''),
                'payment_status' => $paymentStatus,
                'payment_amount' => number_format($paymentAmount / 100, 2, '.', ''),
                'payment_amount_kind' => $paymentAmountKind,
            ];
        })->values();

        $activities = DB::table('reservation_status_history as h')
            ->join('reservations as r', 'r.id', '=', 'h.reservation_id')
            ->leftJoin('users as actor', 'actor.id', '=', 'h.changed_by')
            ->where('r.user_id', $profile->id)
            ->orderByDesc('h.changed_at')
            ->orderByDesc('h.id')
            ->get([
                'h.id', 'h.event', 'h.from_status', 'h.to_status', 'h.reason', 'h.changed_at',
                'h.changed_by', 'r.id as reservation_id', 'r.booking_reference', 'actor.name as actor_name',
            ])
            ->map(fn ($activity): array => [
                'id' => 'reservation-'.$activity->id,
                'kind' => 'reservation',
                'event' => $activity->event ?: 'status_changed',
                'from_status' => $activity->from_status,
                'to_status' => $activity->to_status,
                'reason' => $activity->reason,
                'occurred_at' => CarbonImmutable::parse($activity->changed_at, 'Asia/Manila')->toIso8601String(),
                'reservation_id' => $activity->reservation_id,
                'booking_reference' => $activity->booking_reference,
                'actor_name' => $activity->actor_name,
            ]);

        $activities->push([
            'id' => 'account-created', 'kind' => 'account', 'event' => 'account_created',
            'from_status' => null, 'to_status' => null, 'reason' => null,
            'occurred_at' => CarbonImmutable::parse($profile->created_at, 'Asia/Manila')->toIso8601String(),
            'reservation_id' => null, 'booking_reference' => null, 'actor_name' => $profile->name,
        ]);
        if ($profile->updated_at && $profile->updated_at->ne($profile->created_at)) {
            $activities->push([
                'id' => 'account-updated', 'kind' => 'account', 'event' => 'account_updated',
                'from_status' => null, 'to_status' => null, 'reason' => null,
                'occurred_at' => CarbonImmutable::parse($profile->updated_at, 'Asia/Manila')->toIso8601String(),
                'reservation_id' => null, 'booking_reference' => null, 'actor_name' => $profile->name,
            ]);
        }

        return response()->json([
            'guest' => $profile,
            'reservation' => $reservations->first(),
            'reservations' => $reservations,
            'payments' => $paymentRecords->map(fn ($payment): array => [
                'id' => $payment->id,
                'reservation_id' => $payment->reservation_id,
                'booking_reference' => $payment->booking_reference,
                'amount' => number_format((float) $payment->amount, 2, '.', ''),
                'status' => $payment->status,
                'payment_kind' => $payment->payment_kind,
                'reference' => $payment->reference_number,
                'payment_date' => $payment->payment_date,
                'submitted_at' => CarbonImmutable::parse($payment->submitted_at, 'Asia/Manila')->toIso8601String(),
                'method' => $payment->method,
            ])->values(),
            'activity' => $activities->sortByDesc('occurred_at')->values(),
        ]);
    }

    public function update(Request $request, int $guest): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email:rfc', 'max:255', Rule::unique('users', 'email')->ignore($guest)],
            'phone' => ['nullable', 'string', 'min:7', 'max:30'],
            'address' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['required', 'boolean'],
            'role_id' => ['prohibited'],
            'password' => ['prohibited'],
        ]);

        DB::transaction(function () use ($guest, $validated, $request): void {
            $profile = User::query()
                ->whereKey($guest)
                ->whereHas('role', fn (Builder $query) => $query->where('name', 'guest'))
                ->lockForUpdate()
                ->firstOrFail();

            $fields = ['name', 'email', 'phone', 'address', 'is_active'];
            $before = $profile->only($fields);
            $profile->forceFill([
                'name' => trim($validated['name']),
                'email' => mb_strtolower(trim($validated['email'])),
                'phone' => $this->nullableTrimmed($validated['phone'] ?? null),
                'address' => $this->nullableTrimmed($validated['address'] ?? null),
                'is_active' => $validated['is_active'],
            ])->save();
            app(\App\Services\OwnerAudit::class)->record($request->user(), 'guest_updated', 'Guests', "Updated guest #{$guest}.",
                ['guest_id' => $guest, 'before' => $before, 'after' => $profile->only($fields)]);
        });

        return $this->show($guest);
    }

    private function nullableTrimmed(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
