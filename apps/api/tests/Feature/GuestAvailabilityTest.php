<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class GuestAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_guest_calendar_uses_active_opportunities_blocks_and_half_open_stay_intervals(): void
    {
        $guest = User::factory()->create();
        $day = CarbonImmutable::now('Asia/Manila')->addDays(10);
        $payload = [
            'type' => 'overnight', 'checkin' => $day->toDateString(), 'checkout' => $day->addDay()->toDateString(),
            'checkin_time' => '14:00', 'checkout_time' => '11:00', 'adults' => 2, 'children' => 0, 'pets' => 0,
            'bonfire_qty' => 0, 'charcoal_qty' => 0, 'contact_name' => 'Guest', 'contact_email' => $guest->email,
            'contact_phone' => '09171234567', 'inquiry_source' => 'Website', 'terms' => true,
            'request_key' => '11111111-1111-4111-8111-111111111111',
        ];
        $reservation = $this->actingAs($guest)->postJson('/api/reservations', $payload)->assertCreated()->json('reservation.id');
        $url = '/api/availability?'.http_build_query([
            'start' => $day->toDateString(), 'end' => $day->toDateString(), 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00',
        ]);
        $this->getJson($url)->assertExactJson(['dates' => [$day->toDateString() => 'queue']]);

        $checkoutUrl = '/api/availability?'.http_build_query([
            'start' => $day->toDateString(), 'end' => $day->addDay()->toDateString(), 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00',
            'date_role' => 'checkout', 'anchor_date' => $day->subDay()->toDateString(),
        ]);
        $this->getJson($checkoutUrl)->assertExactJson(['dates' => [
            $day->toDateString() => 'available',
            $day->addDay()->toDateString() => 'queue',
        ]]);

        DB::table('reservation_opportunities')->where('reservation_id', $reservation)->update(['status' => 'expired']);
        DB::table('reservations')->where('id', $reservation)->update(['status' => 'expired']);
        $this->getJson($url)->assertExactJson(['dates' => [$day->toDateString() => 'queue']]);

        DB::table('reservation_opportunities')->where('reservation_id', $reservation)->update(['status' => 'revoked']);
        $this->getJson($url)->assertExactJson(['dates' => [$day->toDateString() => 'available']]);

        DB::table('reservations')->where('id', $reservation)->update(['status' => 'confirmed']);
        $this->getJson($url)->assertExactJson(['dates' => [$day->toDateString() => 'blocked']]);
        $this->getJson($checkoutUrl)->assertExactJson(['dates' => [
            $day->toDateString() => 'available',
            $day->addDay()->toDateString() => 'blocked',
        ]]);

        $turnover = $day->addDay()->toDateString();
        $turnoverUrl = '/api/availability?'.http_build_query([
            'start' => $turnover, 'end' => $turnover, 'type' => 'day_tour', 'duration_days' => 0,
            'checkin_time' => '11:00', 'checkout_time' => '17:00',
        ]);
        $this->getJson($turnoverUrl)->assertExactJson(['dates' => [$turnover => 'available']]);

        $blockDay = $day->addDays(3);
        $block = DB::table('availability_blocks')->insertGetId([
            'villa_id' => 1, 'starts_on' => $blockDay->toDateString(), 'ends_on' => $blockDay->addDay()->toDateString(),
            'reason' => 'Maintenance', 'created_by' => $guest->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $blockUrl = str_replace($turnover, $blockDay->toDateString(), $turnoverUrl);
        $this->getJson($blockUrl)->assertExactJson(['dates' => [$blockDay->toDateString() => 'blocked']]);
        DB::table('availability_blocks')->where('id', $block)->update(['released_at' => now()]);
        $this->getJson($blockUrl)->assertExactJson(['dates' => [$blockDay->toDateString() => 'available']]);
    }
}
