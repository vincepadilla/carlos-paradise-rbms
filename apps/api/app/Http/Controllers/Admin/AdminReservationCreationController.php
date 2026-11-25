<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BookingReservationsController;
use App\Http\Controllers\Controller;
use App\Http\Controllers\ReservationQuoteController;
use App\Http\Controllers\ReservationSettingsController;
use App\Models\Role;
use App\Models\User;
use App\Services\AdminNotificationService;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AdminReservationCreationController extends Controller
{
    public function __construct(
        private ReservationWorkflow $flow,
        private AdminNotificationService $notifications,
        private ReservationSettingsController $settingsController,
        private ReservationQuoteController $quoteController,
    ) {}

    public function options(Request $request): JsonResponse
    {
        $settings = $this->settings();

        return response()->json([
            'creator' => ['id' => $request->user()->id, 'name' => $request->user()->name, 'role' => $request->user()->role?->name],
            'inquiry_sources' => array_values(array_filter($settings['inquiry_sources'], fn ($source) => mb_strtolower($source) !== 'other')),
            'stay_options' => $settings['stay_options'],
            'rates' => [
                'weekday' => (float) $settings['weekday_rate'],
                'friday_saturday' => (float) $settings['friday_saturday_rate'],
                'sunday' => (float) $settings['sunday_rate'],
                'special' => (float) $settings['special_rate'],
                'day_tour' => (float) $settings['day_tour_rate'],
                'holiday_surcharge' => (float) $settings['holiday_surcharge'],
                'bonfire' => (float) $settings['bonfire_price'],
                'charcoal' => (float) $settings['charcoal_price'],
                'liquor' => (float) $settings['liquor_price'],
                'deposit' => (float) $settings['deposit'],
                'security_deposit' => (float) $settings['security_deposit'],
            ],
            'limits' => ['max_guests' => (int) $settings['max_guests'], 'min_lead_days' => (int) $settings['min_lead_days']],
            'timezone' => 'Asia/Manila',
        ]);
    }

    public function guests(Request $request): JsonResponse
    {
        $data = $request->validate(['search' => ['required', 'string', 'min:2', 'max:100']]);
        $pattern = '%'.trim($data['search']).'%';
        $guests = User::query()
            ->where('is_active', true)
            ->whereHas('role', fn (Builder $query) => $query->where('name', 'guest'))
            ->where(function (Builder $query) use ($pattern): void {
                $query->whereLike('name', $pattern, caseSensitive: false)
                    ->orWhereLike('email', $pattern, caseSensitive: false)
                    ->orWhereLike('phone', $pattern, caseSensitive: false);
            })
            ->orderBy('name')
            ->limit(10)
            ->get(['id', 'name', 'email', 'phone']);

        return response()->json(['guests' => $guests]);
    }

    public function preview(Request $request): JsonResponse
    {
        $data = $this->validateRequest($request);
        $guest = $this->validateGuest($data, false);
        $request->merge(['staff_pricing' => true]);
        $result = $this->quoteController->quote($request, $this->settingsController)->getData(true);

        return response()->json([
            ...$result,
            'guest' => $guest,
            'creator' => ['id' => $request->user()->id, 'name' => $request->user()->name, 'role' => $request->user()->role?->name],
        ]);
    }

    public function store(Request $request, BookingReservationsController $bookings): JsonResponse
    {
        $data = $this->validateRequest($request, true);

        return $this->flow->locked(function ($villa) use ($request, $data, $bookings) {
            abort_unless($villa->is_active, 422, 'The villa is not accepting new requests.');

            $existing = DB::table('reservations')
                ->where('created_by', $request->user()->id)
                ->where('request_key', $data['request_key'])
                ->first();
            if ($existing) {
                return response()->json(['reservation' => $this->flow->present($existing)], 201);
            }

            $guest = $this->validateGuest($data, true);
            if ($guest['new']) {
                app(\App\Services\OwnerAudit::class)->record($request->user(), 'guest_created', 'Guests', "Created guest #{$guest['id']}.",
                    ['guest_id' => $guest['id'], 'name' => $guest['name'], 'email' => $guest['email']]);
            }
            $request->merge(['staff_pricing' => true]);
            $result = $this->quoteController->quote($request, $this->settingsController)->getData(true);
            $quote = $result['quote'];
            $availability = $result['availability'];

            if ($availability === 'blocked') {
                throw ValidationException::withMessages(['dates' => 'These dates are no longer available.']);
            }
            if ($availability === 'queue' && ! $request->boolean('queue_acknowledged')) {
                throw ValidationException::withMessages(['dates' => 'Availability changed. Review the waiting notice before saving.']);
            }
            $expected = (int) round((float) $data['expected_total'] * 100);
            $actual = (int) round((float) $quote['total'] * 100);
            if ($expected !== $actual) {
                throw ValidationException::withMessages(['expected_total' => 'Prices changed. Review the updated estimate before saving.']);
            }

            $settings = $this->settings();
            $start = CarbonImmutable::parse($data['checkin'].' '.$data['checkin_time'], 'Asia/Manila');
            $end = CarbonImmutable::parse($data['checkout'].' '.$data['checkout_time'], 'Asia/Manila');
            $status = $availability === 'queue' ? 'queued' : 'awaiting_deposit';
            $requestedAt = $this->flow->now();
            $reservationId = DB::table('reservations')->insertGetId([
                'booking_reference' => $bookings->nextBookingReference($requestedAt),
                'user_id' => $guest['id'],
                'created_by' => $request->user()->id,
                'creation_source' => 'staff_portal',
                'villa_id' => 1,
                'contact_name' => trim($data['contact_name']),
                'contact_email' => mb_strtolower(trim($data['contact_email'])),
                'contact_phone' => trim($data['contact_phone']),
                'inquiry_source' => $data['inquiry_source'],
                'type' => $data['type'],
                'check_in_date' => $data['checkin'],
                'check_out_date' => $data['checkout'],
                'starts_at' => $start->toIso8601String(),
                'ends_at' => $end->toIso8601String(),
                'adults' => $data['adults'],
                'children' => $data['children'],
                'pets' => $data['pets'],
                'bonfire_qty' => $data['bonfire_qty'],
                'charcoal_qty' => $data['charcoal_qty'],
                'liquor_qty' => $data['liquor_qty'],
                'liquor_amount_each' => $settings['liquor_price'],
                'special_requests' => isset($data['notes']) ? trim($data['notes']) ?: null : null,
                'status' => $status,
                'quoted_total' => $quote['total'],
                'required_deposit' => $quote['deposit'],
                'currency' => 'PHP',
                'price_agreed' => true,
                'pricing_snapshot' => json_encode([...$quote, 'version' => 2], JSON_THROW_ON_ERROR),
                'policy_snapshot' => json_encode(['accepted_at' => $requestedAt->toIso8601String(), 'accepted_by_staff' => $request->user()->id, 'settings' => $settings], JSON_THROW_ON_ERROR),
                'requested_at' => $requestedAt->toIso8601String(),
                'deposit_window_hours' => $settings['opportunity_hours'],
                'request_key' => $data['request_key'],
                'created_at' => $this->flow->stamp(),
                'updated_at' => $this->flow->stamp(),
            ]);

            if ($status === 'awaiting_deposit') {
                $record = $this->flow->reservation($reservationId, true);
                $deadline = $this->flow->createOpportunity($record, $request->user()->id);
                DB::table('reservations')->where('id', $reservationId)->update(['deadline' => $deadline->toIso8601String(), 'updated_at' => $this->flow->stamp()]);
            }

            $this->flow->history($reservationId, null, $status, $request->user()->id, 'Staff created a reservation on behalf of the guest.', 'staff_created_reservation', ['guest_mode' => $data['guest_mode'], 'created_by' => $request->user()->id]);
            $record = $this->flow->reservation($reservationId);
            $this->notifications->reservationCreated($record);

            return response()->json(['reservation' => $this->flow->present($record)], 201);
        });
    }

    private function validateRequest(Request $request, bool $saving = false): array
    {
        $settings = $this->settings();
        $sources = array_values(array_filter($settings['inquiry_sources'], fn ($source) => mb_strtolower($source) !== 'other'));
        $rules = [
            'guest_mode' => ['required', Rule::in(['existing', 'new'])],
            'guest_id' => ['nullable', 'integer', 'required_if:guest_mode,existing'],
            'contact_name' => ['required', 'string', 'max:255'],
            'contact_email' => ['required', 'email:rfc', 'max:254'],
            'contact_phone' => ['required', 'string', 'regex:/^09[0-9]{9}$/'],
            'inquiry_source' => ['required', Rule::in($sources)],
            'type' => ['required', Rule::in(collect($settings['stay_options'])->pluck('value')->all())],
            'checkin' => ['required', 'date_format:Y-m-d'],
            'checkout' => ['required', 'date_format:Y-m-d'],
            'checkin_time' => ['required', 'date_format:H:i'],
            'checkout_time' => ['required', 'date_format:H:i'],
            'adults' => ['required', 'integer', 'min:1', 'max:'.$settings['max_guests']],
            'children' => ['required', 'integer', 'min:0', 'max:'.$settings['max_guests']],
            'pets' => ['required', 'integer', 'min:0', 'max:10'],
            'bonfire_qty' => ['required', 'integer', 'min:0', 'max:20'],
            'charcoal_qty' => ['required', 'integer', 'min:0', 'max:100'],
            'liquor_qty' => ['required', 'integer', 'min:0', 'max:100'],
            'liquor_amount_each' => ['prohibited'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'queue_acknowledged' => ['sometimes', 'boolean'],
        ];
        if ($saving) {
            $rules['request_key'] = ['required', 'uuid'];
            $rules['expected_total'] = ['required', 'numeric', 'min:0', 'max:99999999'];
        }

        return $request->validate($rules, ['contact_phone.regex' => 'The contact number must contain exactly 11 digits and begin with 09.']);
    }

    private function validateGuest(array $data, bool $create): array
    {
        if ($data['guest_mode'] === 'existing') {
            $query = User::query()->whereKey($data['guest_id'])->where('is_active', true)
                ->whereHas('role', fn (Builder $role) => $role->where('name', 'guest'));
            if ($create) $query->lockForUpdate();
            $guest = $query->first();
            if (! $guest) throw ValidationException::withMessages(['guest_id' => 'Select an active guest account.']);
            return ['id' => $guest->id, 'name' => $guest->name, 'email' => $guest->email, 'phone' => $guest->phone, 'new' => false];
        }

        $email = mb_strtolower(trim($data['contact_email']));
        if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
            throw ValidationException::withMessages(['contact_email' => 'An account already uses this email. Select Existing Guest instead.']);
        }
        if (! $create) return ['id' => null, 'name' => trim($data['contact_name']), 'email' => $email, 'phone' => trim($data['contact_phone']), 'new' => true];

        $guest = new User();
        $guest->name = trim($data['contact_name']);
        $guest->email = $email;
        $guest->phone = trim($data['contact_phone']);
        $guest->password = null;
        $guest->is_active = true;
        $guest->role()->associate(Role::where('name', 'guest')->sole());
        try {
            $guest->save();
        } catch (QueryException $exception) {
            if (User::query()->whereRaw('lower(email) = ?', [$email])->exists()) {
                throw ValidationException::withMessages(['contact_email' => 'An account already uses this email. Select Existing Guest instead.']);
            }
            throw $exception;
        }

        return ['id' => $guest->id, 'name' => $guest->name, 'email' => $guest->email, 'phone' => $guest->phone, 'new' => true];
    }

    private function settings(): array
    {
        return $this->settingsController->index()->getData(true)['settings'];
    }
}
