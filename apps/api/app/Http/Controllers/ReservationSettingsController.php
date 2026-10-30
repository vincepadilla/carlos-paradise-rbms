<?php

namespace App\Http\Controllers;
use Illuminate\Http\Request;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReservationSettingsController extends Controller
{
    public function index()
    {
        // Defaults from your reservation prototype.
        $settings = [
            'name' => 'Carlos Paradise',
            'contact' => '',
            'payment_instructions' =>
                'Contact the resort for verified payment details.',

            'weekday_rate' => 16000,
            'friday_saturday_rate' => 22000,
            'sunday_rate' => 18000,
            'special_rate' => 22000,

            'holiday_surcharge' => 2000,
            'special_dates' => [
                '12-24',
                '12-25',
                '12-31',
                '01-01',
            ],
            'holiday_dates' => [],

            'standard_guests' => 20,
            'max_guests' => 40,
            'extra_guest_fee' => 500,

            'cleaning_threshold' => 30,
            'cleaning_fee' => 1000,

            'bonfire_price' => 400,
            'charcoal_price' => 30,

            'deposit' => 5000,
            'security_deposit' => 3000,
            'opportunity_hours' => 24,
            'min_lead_days' => 2,
        ];

        // Use saved villa settings when available.
        $villa = DB::table('villas')
            ->where('id', 1)
            ->first();

        if ($villa) {
            $savedSettings = json_decode(
                $villa->settings ?? '{}',
                true
            );

            if (is_array($savedSettings)) {
                $settings = array_replace(
                    $settings,
                    $savedSettings
                );
            }

            $settings = array_replace($settings, [
                'name' => $villa->name,

                'weekday_rate' =>
                    (float) $villa->base_nightly_rate,

                'standard_guests' =>
                    (int) $villa->included_guests,

                'max_guests' =>
                    (int) $villa->maximum_guests,

                'extra_guest_fee' =>
                    (float) $villa->extra_guest_rate,

                'deposit' =>
                    (float) $villa->deposit_amount,

                'opportunity_hours' =>
                    (int) $villa->deposit_window_hours,
            ]);
        }

        // Payment tables have not been created yet.
        // Return no receiving accounts until configured.
        $paymentMethods = [];

        if (Schema::hasTable('payment_methods')) {
            $columns = [
                'id',
                'name',
                'account_name',
                'account_number',
                'instructions',
            ];

            if (Schema::hasColumn('payment_methods', 'qr_code_url')) {
                $columns[] = 'qr_code_url';
            }

            $paymentMethods = DB::table('payment_methods')
                ->where('is_active', true)
                ->orderBy('name')
                ->get($columns)
                ->map(function ($method) {
                    $method->qr_code_url ??= null;

                    return $method;
                });
        }

        return response()->json([
            'settings' => $settings,
            'payment_methods' => $paymentMethods,
        ]);
    }
}
