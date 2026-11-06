<?php

namespace App\Services;

use App\Http\Controllers\ReservationSettingsController;
use Illuminate\Support\Facades\DB;

class ReservationDetailData
{
    public function __construct(private ReservationManagement $management) {}

    public function present(object $record): array
    {
        $pricing = json_decode($record->pricing_snapshot ?? '{}', true);
        $policy = json_decode($record->policy_snapshot ?? '{}', true);
        $pricing = is_array($pricing) ? $pricing : [];
        $settings = is_array($policy) && is_array($policy['settings'] ?? null) ? $policy['settings'] : [];
        $bonfire = $this->itemAmount($record->bonfire_qty, $settings['bonfire_price'] ?? null);
        $charcoal = $this->itemAmount($record->charcoal_qty, $settings['charcoal_price'] ?? null);
        $optional = $this->amount($pricing['optional_fee'] ?? null);
        // Do not invent a breakdown when a historical snapshot no longer reconciles.
        if ($optional === null || $bonfire === null || $charcoal === null || abs((float) $optional - (float) $bonfire - (float) $charcoal) > 0.005) {
            $bonfire = $charcoal = null;
        }
        if (($pricing['version'] ?? null) === 2) {
            $bonfire = $this->amount($pricing['bonfire'] ?? null);
            $charcoal = $this->amount($pricing['charcoal'] ?? null);
        }
        $damages = DB::table('reservation_damages')->where('reservation_id', $record->id)->whereNull('deleted_at')->orderBy('id')->get()
            ->map(fn ($damage) => ['id' => $damage->id, 'description' => $damage->description, 'item_area' => $damage->item_area, 'amount' => $this->amount($damage->amount), 'notes' => $damage->notes, 'created_by' => $damage->created_by, 'created_at' => $damage->created_at]);
        $damageCents = $damages->sum(fn ($damage) => ReservationPricing::cents($damage['amount']));
        $paidCents = $this->management->paid($record->id);
        $configured = app(ReservationSettingsController::class)->index()->getData(true)['settings']['security_deposit'];

        return [
            'inquiry_source' => $record->inquiry_source,
            'bonfire_qty' => (int) $record->bonfire_qty,
            'charcoal_qty' => (int) $record->charcoal_qty,
            'contact_address' => $record->contact_address,
            'revision' => (int) $record->admin_revision,
            'capabilities' => $this->management->capabilities($record),
            'damages' => $damages,
            'configured_security_deposit' => $this->amount($configured),
            'totals' => ReservationPricing::balance(ReservationPricing::cents($record->quoted_total), $damageCents, $paidCents, (bool) $record->price_agreed),
            'audit' => DB::table('reservation_status_history')->where('reservation_id', $record->id)->orderByDesc('id')->limit(50)->get(['id', 'event', 'changed_by', 'changed_at', 'reason', 'changes'])
                ->map(function ($event) { $event->changes = $event->changes ? json_decode($event->changes, true) : null; return $event; }),
            'pricing' => [
                'base' => $this->amount($pricing['base'] ?? null),
                'holiday_fee' => $this->amount($pricing['holiday_fee'] ?? null),
                'extra_fee' => $this->amount($pricing['extra_fee'] ?? null),
                'cleaning_fee' => $this->amount($pricing['cleaning_fee'] ?? null),
                'optional_fee' => $optional, 'bonfire' => $bonfire, 'charcoal' => $charcoal,
                'liquor' => $this->amount($pricing['liquor'] ?? null), 'other' => $this->amount($pricing['other'] ?? null),
                'version' => $pricing['version'] ?? null,
                'discount' => $pricing['discount'] ?? null,
                'security_deposit' => $this->amount($pricing['security_deposit'] ?? $settings['security_deposit'] ?? null),
            ],
        ];
    }

    private function amount(mixed $value): ?string
    {
        if (!is_numeric($value) || !is_finite((float) $value) || (float) $value < 0) return null;

        return number_format((float) $value, 2, '.', '');
    }

    private function itemAmount(int $quantity, mixed $rate): ?string
    {
        if ($quantity === 0) return '0.00';
        $unit = $this->amount($rate);

        return $unit === null ? null : $this->amount($quantity * (float) $unit);
    }
}
