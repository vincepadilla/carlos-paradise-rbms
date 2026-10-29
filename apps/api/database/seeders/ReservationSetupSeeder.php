<?php

namespace Database\Seeders;

use App\Http\Controllers\ReservationSettingsController;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class ReservationSetupSeeder extends Seeder
{
    public function run(): void
    {
        // Keep an existing villa and its settings.
        if (DB::table('villas')->where('id', 1)->exists()) {
            return;
        }

        $settings = app(ReservationSettingsController::class)
            ->index()
            ->getData(true)['settings'];

        $timestamp = now('Asia/Manila')
            ->format('Y-m-d H:i:s');

        DB::table('villas')->insert([
            'id' => 1,
            'name' => $settings['name'],
            'description' => null,

            'address' => env(
                'RESORT_ADDRESS',
                'Update resort address'
            ),

            'timezone' => 'Asia/Manila',

            'base_nightly_rate' => $settings['weekday_rate'],
            'included_guests' => $settings['standard_guests'],
            'maximum_guests' => $settings['max_guests'],
            'extra_guest_rate' => $settings['extra_guest_fee'],

            'child_guest_weight' => 1,
            'pet_limit' => 10,
            'pet_fee' => 0,

            'check_in_time' => '14:00:00',
            'check_out_time' => '11:00:00',

            'deposit_amount' => $settings['deposit'],
            'deposit_window_hours' =>
                $settings['opportunity_hours'],

            'settings' => json_encode(
                $settings,
                JSON_THROW_ON_ERROR
            ),

            'is_active' => true,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ]);

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(
                "SELECT setval(
                    pg_get_serial_sequence('villas', 'id'),
                    GREATEST((SELECT MAX(id) FROM villas), 1),
                    true
                )"
            );
        }
    }
}