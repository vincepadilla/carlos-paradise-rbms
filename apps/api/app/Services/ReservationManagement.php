<?php

namespace App\Services;

use App\Http\Controllers\ReservationSettingsController;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ReservationManagement
{
    public function __construct(private ReservationWorkflow $flow, private ReservationPricing $pricing) {}

    public function paid(int $id): int
    {
        return DB::table('payments')->where('reservation_id', $id)->where('status', 'approved')->get(['amount'])
            ->sum(fn ($payment) => ReservationPricing::cents($payment->amount));
    }

    public function capabilities(object $record): array
    {
        $now = $this->flow->now();
        $start = CarbonImmutable::parse($record->starts_at, 'Asia/Manila');
        $end = CarbonImmutable::parse($record->ends_at, 'Asia/Manila');
        $confirmed = $record->status === 'confirmed' && $record->price_agreed && $this->paid($record->id) >= ReservationPricing::cents($record->required_deposit);
        return [
            'can_edit' => $confirmed && $end->gt($now),
            'can_manage_damages' => $confirmed && $start->lte($now) && $end->gt($now),
            'can_complete' => $confirmed && $start->lte($now),
            'can_grant_extension' => $record->status === 'awaiting_deposit' && $record->deadline && CarbonImmutable::parse($record->deadline)->gt($now) && $record->extension_status !== 'pending',
        ];
    }

    public function checkRevision(object $record, int $revision): void
    {
        abort_unless((int) $record->admin_revision === $revision, 409, 'This reservation changed in another session. Reload its latest details before saving.');
    }

    public function audit(object $record, int $actor, string $event, array $before, array $after): void
    {
        $this->flow->history($record->id, $record->status, $record->status, $actor, str_replace('_', ' ', $event), $event, ['before' => $before, 'after' => $after]);
    }

    public function update(int $id, int $actor, array $data): void
    {
        $this->flow->locked(function () use ($id, $actor, $data) {
            $record = $this->flow->reservation($id, true);
            $this->checkRevision($record, $data['revision']);
            $capabilities = $this->capabilities($record);
            abort_unless($capabilities['can_edit'], 422, 'Only an active or future confirmed reservation with a verified deposit can be edited.');
            $schedule = $this->schedule($record, $data);
            $settings = app(ReservationSettingsController::class)->index()->getData(true)['settings'];
            if ($data['adults'] + $data['children'] > $settings['max_guests']) {
                throw ValidationException::withMessages(['adults' => 'The total number of guests exceeds the villa capacity.']);
            }
            $snapshot = json_decode($record->pricing_snapshot, true);
            $snapshot = is_array($snapshot) ? $snapshot : [];
            $prices = $this->pricing->calculate($data['pricing'], $data['discount'], $record->required_deposit);
            $prices['discount']['applied_by'] = $actor;
            $prices['discount']['applied_at'] = $this->flow->now()->toIso8601String();
            $updates = [
                ...$schedule, 'type' => $data['type'], 'contact_name' => trim($data['contact_name']),
                'contact_email' => $data['contact_email'], 'contact_phone' => trim($data['contact_phone']),
                'contact_address' => $data['contact_address'] ?? null, 'inquiry_source' => trim($data['inquiry_source']),
                'adults' => $data['adults'], 'children' => $data['children'], 'pets' => $data['pets'], 'special_requests' => $data['notes'] ?? null,
                'quoted_total' => $prices['total'], 'pricing_snapshot' => json_encode(array_replace($snapshot, $prices), JSON_THROW_ON_ERROR),
                'processed_by' => $actor, 'processed_at' => $this->flow->now()->toIso8601String(),
                'admin_revision' => $record->admin_revision + 1, 'updated_at' => $this->flow->stamp(),
            ];
            $before = array_intersect_key((array) $record, $updates);
            DB::table('reservations')->where('id', $id)->update($updates);
            $this->audit($record, $actor, 'reservation_edited', $before, $updates);
            if ($schedule['starts_at'] !== CarbonImmutable::parse($record->starts_at)->toIso8601String() || $schedule['ends_at'] !== CarbonImmutable::parse($record->ends_at)->toIso8601String()) {
                $this->audit($record, $actor, 'schedule_changed', ['starts_at' => $record->starts_at, 'ends_at' => $record->ends_at], $schedule);
            }
            $this->audit($record, $actor, 'pricing_updated', $snapshot, $prices);
            if (($snapshot['discount'] ?? null) !== $prices['discount']) $this->audit($record, $actor, 'discount_changed', $snapshot['discount'] ?? [], $prices['discount']);
            if (array_key_exists('damages', $data)) {
                abort_unless($capabilities['can_manage_damages'], 422, 'Damage records can only be changed during an ongoing stay.');
                $this->saveDamages($record, $actor, $data['damages']);
            }
        });
    }

    private function schedule(object $record, array $data): array
    {
        $start = CarbonImmutable::parse($data['checkin'].' '.$data['checkin_time'], 'Asia/Manila');
        $end = CarbonImmutable::parse($data['checkout'].' '.$data['checkout_time'], 'Asia/Manila');
        $oldStart = CarbonImmutable::parse($record->starts_at, 'Asia/Manila')->setTimezone('Asia/Manila');
        $oldEnd = CarbonImmutable::parse($record->ends_at, 'Asia/Manila')->setTimezone('Asia/Manila');
        // Inputs expose minutes; preserve recorded seconds when that minute was not changed.
        if ($start->format('Y-m-d H:i') === $oldStart->format('Y-m-d H:i')) $start = $oldStart;
        if ($end->format('Y-m-d H:i') === $oldEnd->format('Y-m-d H:i')) $end = $oldEnd;
        if (! $end->gt($start) || $end->timestamp - $start->timestamp > 30 * 86400 || $end->lte($this->flow->now()) || $end->gt($this->flow->now()->addYears(2))) {
            throw ValidationException::withMessages(['checkout' => 'The stay must end after arrival, remain active, and last at most 30 days within the next two years.']);
        }
        if (($data['type'] === 'day_tour' && $data['checkin'] !== $data['checkout']) || ($data['type'] === 'overnight' && $data['checkout'] <= $data['checkin'])) {
            throw ValidationException::withMessages(['checkout' => 'Day tours use the same date. Overnight stays require a later check-out date.']);
        }
        if ($oldStart->lte($this->flow->now()) && (! $start->equalTo($oldStart) || $data['type'] !== $record->type)) {
            throw ValidationException::withMessages(['checkin' => 'An ongoing stay must keep its recorded check-in and visit type.']);
        }
        if ($oldStart->gt($this->flow->now()) && (! $start->equalTo($oldStart) || ! $end->equalTo($oldEnd) || $data['type'] !== $record->type)) {
            $settings = app(ReservationSettingsController::class)->index()->getData(true)['settings'];
            if ($start->toDateString() < $this->flow->now()->addDays($settings['min_lead_days'])->toDateString()) {
                throw ValidationException::withMessages(['checkin' => 'A changed future schedule must respect the resort minimum lead time.']);
            }
        }
        $candidate = (object) [...(array) $record, 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String()];
        $this->flow->available($candidate, false);

        return ['starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'check_in_date' => $data['checkin'], 'check_out_date' => $data['checkout']];
    }

    private function saveDamages(object $record, int $actor, array $damages): void
    {
        $existing = DB::table('reservation_damages')->where('reservation_id', $record->id)->whereNull('deleted_at')->lockForUpdate()->get()->keyBy('id');
        $keep = [];
        foreach ($damages as $damage) {
            $values = ['description' => trim($damage['description']), 'item_area' => trim($damage['item_area']), 'amount' => ReservationPricing::money(ReservationPricing::cents($damage['amount'])), 'notes' => $damage['notes'] ?? null, 'updated_by' => $actor, 'updated_at' => $this->flow->stamp()];
            $id = isset($damage['id']) ? (int) $damage['id'] : null;
            if ($id !== null) {
                abort_unless($existing->has($id), 422, 'A damage record does not belong to this reservation or was already removed.');
                DB::table('reservation_damages')->where('id', $id)->update($values);
                $this->audit($record, $actor, 'damage_edited', (array) $existing[$id], ['id' => $id, ...$values]);
            } else {
                $id = DB::table('reservation_damages')->insertGetId(['reservation_id' => $record->id, 'created_by' => $actor, 'created_at' => $this->flow->stamp(), ...$values]);
                $this->audit($record, $actor, 'damage_added', [], ['id' => $id, ...$values]);
            }
            $keep[] = $id;
        }
        foreach ($existing as $id => $damage) {
            if (in_array($id, $keep, true)) continue;
            DB::table('reservation_damages')->where('id', $id)->update(['deleted_at' => $this->flow->now()->toIso8601String(), 'deleted_by' => $actor]);
            $this->audit($record, $actor, 'damage_removed', (array) $damage, ['deleted_by' => $actor]);
        }
    }

    public function complete(int $id, int $actor, int $revision): void
    {
        $this->flow->locked(function () use ($id, $actor, $revision) {
            $record = $this->flow->reservation($id, true);
            $this->checkRevision($record, $revision);
            abort_unless($this->capabilities($record)['can_complete'], 422, 'Only a verified ongoing or past confirmed stay can be completed.');
            $completed = $this->flow->now()->toIso8601String();
            $this->flow->state($record, 'completed', $actor, 'Admin verified checkout, payments and final charges.', ['completed_at' => $completed, 'processed_by' => $actor, 'processed_at' => $completed]);
            $this->audit((object) [...(array) $record, 'status' => 'completed'], $actor, 'reservation_completed', ['status' => 'confirmed'], ['status' => 'completed', 'completed_at' => $completed]);
        });
    }
}
