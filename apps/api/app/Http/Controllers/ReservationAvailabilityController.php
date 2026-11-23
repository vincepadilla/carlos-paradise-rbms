<?php

namespace App\Http\Controllers;

use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReservationAvailabilityController extends Controller
{
    public function index(Request $request, ReservationAvailability $availability, ReservationSettingsController $settingsController)
    {
        $settings = $settingsController->index()->getData(true)['settings'];
        $earliest = CarbonImmutable::now('Asia/Manila')->addDays((int) $settings['min_lead_days'])->toDateString();
        $latest = CarbonImmutable::now('Asia/Manila')->addYears(2)->toDateString();
        $data = $request->validate([
            'start' => ['required', 'date_format:Y-m-d'], 'end' => ['required', 'date_format:Y-m-d', 'after_or_equal:start'],
            'type' => ['required', Rule::in(['overnight', 'day_tour'])], 'duration_days' => ['required', 'integer', 'min:0', 'max:30'],
            'checkin_time' => ['required', 'date_format:H:i'], 'checkout_time' => ['required', 'date_format:H:i'],
            'date_role' => ['sometimes', Rule::in(['checkin', 'checkout'])],
            'anchor_date' => ['required_if:date_role,checkout', 'nullable', 'date_format:Y-m-d'],
        ]);
        $rangeStart = CarbonImmutable::createFromFormat('!Y-m-d', $data['start'], 'Asia/Manila');
        $rangeEnd = CarbonImmutable::createFromFormat('!Y-m-d', $data['end'], 'Asia/Manila');
        if ($rangeStart->diffInDays($rangeEnd) > 42) {
            throw ValidationException::withMessages(['end' => 'Availability can be requested for at most 43 calendar days.']);
        }
        if (($data['type'] === 'overnight' && (int) $data['duration_days'] < 1) || ($data['type'] === 'day_tour' && (int) $data['duration_days'] !== 0)) {
            throw ValidationException::withMessages(['duration_days' => 'The duration does not match the reservation type.']);
        }
        $dates = [];
        $intervals = [];
        for ($date = $rangeStart; $date->lte($rangeEnd); $date = $date->addDay()) {
            $dateString = $date->toDateString();
            $checkoutMode = ($data['date_role'] ?? 'checkin') === 'checkout';
            $checkin = $checkoutMode
                ? CarbonImmutable::createFromFormat('!Y-m-d', $data['anchor_date'], 'Asia/Manila')
                : $date;
            $checkout = $checkoutMode ? $date : $date->addDays((int) $data['duration_days']);
            $stayStart = CarbonImmutable::parse($checkin->toDateString().' '.$data['checkin_time'], 'Asia/Manila');
            $stayEnd = CarbonImmutable::parse($checkout->toDateString().' '.$data['checkout_time'], 'Asia/Manila');
            $typeDatesValid = $data['type'] === 'day_tour'
                ? $checkout->isSameDay($checkin)
                : $checkout->gt($checkin);
            if ($checkin->toDateString() < $earliest || $checkout->toDateString() > $latest || ! $typeDatesValid || ! $stayEnd->gt($stayStart) || $stayEnd->timestamp - $stayStart->timestamp > 30 * 86400) {
                $dates[$dateString] = 'blocked';

                continue;
            }
            $dates[$dateString] = 'blocked';
            $intervals[$dateString] = ['start' => $stayStart, 'end' => $stayEnd];
        }
        $dates = array_replace($dates, $availability->forCalendar($intervals, $data['type']));

        return response()->json(['dates' => $dates]);
    }
}
