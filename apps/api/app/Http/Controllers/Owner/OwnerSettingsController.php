<?php

namespace App\Http\Controllers\Owner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\ReservationSettingsController;
use App\Services\OwnerAudit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OwnerSettingsController extends Controller
{
    private const TEXT = ['contact', 'reservation_instructions', 'payment_deadline_instructions', 'payment_instructions',
        'amenities', 'inclusions', 'landing_title', 'landing_description', 'policies'];
    private const MONEY = ['deposit', 'security_deposit', 'weekday_rate', 'friday_saturday_rate', 'sunday_rate',
        'special_rate', 'day_tour_rate', 'holiday_surcharge', 'extra_guest_fee', 'cleaning_fee', 'bonfire_price', 'charcoal_price', 'liquor_price'];
    private const COLUMNS = ['name' => 'name', 'address' => 'address', 'description' => 'description',
        'weekday_rate' => 'base_nightly_rate', 'standard_guests' => 'included_guests', 'max_guests' => 'maximum_guests',
        'extra_guest_fee' => 'extra_guest_rate', 'deposit' => 'deposit_amount', 'opportunity_hours' => 'deposit_window_hours',
        'check_in_time' => 'check_in_time', 'check_out_time' => 'check_out_time'];

    public function index(ReservationSettingsController $settings)
    {
        return $settings->index();
    }

    public function update(Request $request, ReservationSettingsController $settings, OwnerAudit $audit)
    {
        $rules = ['name' => ['sometimes', 'required', 'string', 'max:255'],
            'address' => ['sometimes', 'required', 'string', 'max:1000'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'opportunity_hours' => ['sometimes', 'integer', 'between:1,720'],
            'min_lead_days' => ['sometimes', 'integer', 'between:0,365'],
            'standard_guests' => ['sometimes', 'integer', 'between:1,10000'],
            'max_guests' => ['sometimes', 'integer', 'between:1,10000'],
            'cleaning_threshold' => ['sometimes', 'integer', 'between:0,10000'],
            'check_in_time' => ['sometimes', 'date_format:H:i'],
            'check_out_time' => ['sometimes', 'date_format:H:i'],
            'notification_email' => ['sometimes', 'nullable', 'email', 'max:254'],
        ];
        foreach (self::TEXT as $key) $rules[$key] = ['sometimes', 'nullable', 'string', 'max:10000'];
        foreach (self::MONEY as $key) $rules[$key] = ['sometimes', 'numeric', 'decimal:0,2', 'between:0,99999999'];
        $data = $request->validate($rules);
        if ($data === []) throw ValidationException::withMessages(['settings' => 'Provide at least one supported setting.']);

        DB::transaction(function () use ($data, $request, $audit) {
            $villa = DB::table('villas')->where('id', 1)->lockForUpdate()->first();
            abort_unless($villa, 503, 'The resort must be configured first.');
            $standard = $data['standard_guests'] ?? $villa->included_guests;
            $maximum = $data['max_guests'] ?? $villa->maximum_guests;
            if ($standard > $maximum) throw ValidationException::withMessages(['standard_guests' => 'Included guests cannot exceed maximum capacity.']);
            $saved = array_replace(json_decode($villa->settings ?? '{}', true) ?: [], $data);
            // Keep the existing stay-options contract in step with the operational columns.
            if (isset($data['check_in_time']) || isset($data['check_out_time'])) {
                $saved['stay_options'] = [
                    ['value' => 'overnight', 'label' => 'Overnight Stay',
                        'checkin_time' => $data['check_in_time'] ?? substr($villa->check_in_time, 0, 5),
                        'checkout_time' => $data['check_out_time'] ?? substr($villa->check_out_time, 0, 5)],
                    ['value' => 'day_tour', 'label' => 'Day Tour', 'checkin_time' => '08:00', 'checkout_time' => '17:00'],
                ];
            }
            $update = ['settings' => json_encode($saved, JSON_THROW_ON_ERROR), 'updated_at' => now()];
            foreach (self::COLUMNS as $key => $column) if (array_key_exists($key, $data)) $update[$column] = $data[$key];
            DB::table('villas')->where('id', 1)->update($update);
            $audit->record($request->user(), 'settings_updated', 'System Settings', 'Updated: '.implode(', ', array_keys($data)).'.');
        });
        return $settings->index();
    }

    public function paymentMethods()
    {
        return response()->json(['payment_methods' => DB::table('payment_methods')->orderBy('id')->get()]);
    }

    public function savePaymentMethod(Request $request, OwnerAudit $audit)
    {
        $data = $request->validate([
            'id' => ['nullable', 'integer', 'exists:payment_methods,id'],
            'name' => ['required', 'string', 'max:255'], 'account_name' => ['required', 'string', 'max:255'],
            'account_number' => ['required', 'string', 'max:255'], 'instructions' => ['nullable', 'string', 'max:5000'],
            'is_active' => ['required', 'boolean'],
        ]);
        DB::transaction(function () use ($data, $request, $audit) {
            $duplicate = DB::table('payment_methods')->where('name', $data['name'])->where('account_number', $data['account_number']);
            if (!empty($data['id'])) $duplicate->where('id', '!=', $data['id']);
            if ($duplicate->exists()) throw ValidationException::withMessages(['account_number' => 'This payment account already exists.']);
            $id = $data['id'] ?? null;
            unset($data['id']);
            if ($id) DB::table('payment_methods')->where('id', $id)->update([...$data, 'updated_at' => now()]);
            else $id = DB::table('payment_methods')->insertGetId([...$data, 'created_at' => now(), 'updated_at' => now()]);
            $audit->record($request->user(), 'payment_method_saved', 'Payment Settings', "Saved payment method #{$id}.");
        });
        return $this->paymentMethods();
    }
}
