<?php

namespace App\Http\Controllers;

use App\Services\ReservationAvailability;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ReservationQuoteController extends Controller
{
    public function __construct(private ReservationAvailability $availabilityService) {}

    public function quote(
        Request $request,
        ReservationSettingsController $settingsController
    ) {
        // Reuse the same prices supplied to the reservation page.
        $configuration = $settingsController
            ->index()
            ->getData(true);

        $settings = $configuration['settings'];

        $earliest = CarbonImmutable::now('Asia/Manila')
            ->addDays((int) $settings['min_lead_days'])
            ->toDateString();

        $latest = CarbonImmutable::now('Asia/Manila')
            ->addYears(2)
            ->toDateString();

        $data = $request->validate([
            'type' => [
                'required',
                Rule::in(['overnight', 'day_tour']),
            ],

            'checkin' => [
                'required',
                'date_format:Y-m-d',
                'after_or_equal:'.$earliest,
            ],

            'checkout' => [
                'required',
                'date_format:Y-m-d',
                'after_or_equal:checkin',
                'before_or_equal:'.$latest,
            ],

            'checkin_time' => [
                'required',
                'date_format:H:i',
            ],

            'checkout_time' => [
                'required',
                'date_format:H:i',
            ],

            'adults' => [
                'required',
                'integer',
                'min:1',
                'max:'.$settings['max_guests'],
            ],

            'children' => [
                'required',
                'integer',
                'min:0',
                'max:'.$settings['max_guests'],
            ],

            'pets' => 'required|integer|min:0|max:10',

            'bonfire_qty' => 'required|integer|min:0|max:20',

            'charcoal_qty' => 'required|integer|min:0|max:100',

            'liquor_qty' => 'sometimes|integer|min:0|max:100',

            'notes' => 'nullable|string|max:2000',

            'staff_pricing' => 'sometimes|boolean',
        ]);

        $start = CarbonImmutable::parse(
            $data['checkin'].' '.$data['checkin_time'],
            'Asia/Manila'
        );

        $end = CarbonImmutable::parse(
            $data['checkout'].' '.$data['checkout_time'],
            'Asia/Manila'
        );

        $guests = $data['adults'] + $data['children'];

        if ($guests > (int) $settings['max_guests']) {
            throw ValidationException::withMessages([
                'adults' => 'The total number of guests exceeds the villa capacity.',
            ]);
        }

        if (
            ! $end->gt($start) ||
            $end->timestamp - $start->timestamp > 30 * 86400
        ) {
            throw ValidationException::withMessages([
                'checkout' => 'The stay must end after arrival and cannot exceed 30 days.',
            ]);
        }

        if (
            $data['type'] === 'day_tour' &&
            $data['checkin'] !== $data['checkout']
        ) {
            throw ValidationException::withMessages([
                'checkout' => 'Day tours must start and end on the same date.',
            ]);
        }

        if (
            $data['type'] === 'overnight' &&
            (
                $data['checkout'] <= $data['checkin'] ||
                $data['checkin_time'] !== $settings['check_in_time'] ||
                $data['checkout_time'] !== $settings['check_out_time']
            )
        ) {
            throw ValidationException::withMessages([
                'checkin_time' => 'Overnight stays use the configured check-in and check-out times on a later date.',
            ]);
        }

        /*
         * Calculate accommodation charges.
         */
        $staffPricing = $request->boolean('staff_pricing')
            && app(ReservationWorkflow::class)->staff($request->user());

        $base = $data['type'] === 'day_tour' && $staffPricing
            ? (float) $settings['day_tour_rate']
            : 0;
        $holidayFee = 0;

        if ($data['type'] === 'overnight') {
            $lastDay = CarbonImmutable::parse(
                $data['checkout'],
                'Asia/Manila'
            );

            for (
                $day = CarbonImmutable::parse(
                    $data['checkin'],
                    'Asia/Manila'
                );
                $day->lt($lastDay);
                $day = $day->addDay()
            ) {
                if (
                    in_array(
                        $day->format('m-d'),
                        $settings['special_dates'],
                        true
                    )
                ) {
                    $base += $settings['special_rate'];
                } elseif ($day->isSunday()) {
                    $base += $settings['sunday_rate'];
                } elseif (in_array($day->dayOfWeek, [5, 6], true)) {
                    $base += $settings['friday_saturday_rate'];
                } else {
                    $base += $settings['weekday_rate'];
                }

                if (
                    in_array(
                        $day->toDateString(),
                        $settings['holiday_dates'],
                        true
                    )
                ) {
                    $holidayFee += $settings['holiday_surcharge'];
                }
            }
        }

        $extraGuests = max(
            0,
            $guests - (int) $settings['standard_guests']
        );

        $extraFee = $extraGuests
            * (float) $settings['extra_guest_fee'];

        $cleaningFee =
            $guests >= (int) $settings['cleaning_threshold']
                ? (float) $settings['cleaning_fee']
                : 0;

        $optionalFee =
            $data['bonfire_qty']
                * (float) $settings['bonfire_price']
            + $data['charcoal_qty']
                * (float) $settings['charcoal_price']
            + ($data['liquor_qty'] ?? 0)
                * (float) $settings['liquor_price'];

        $total = $data['type'] === 'day_tour' && ! $staffPricing
            ? null
            : round(
                $base
                + $holidayFee
                + $extraFee
                + $cleaningFee
                + $optionalFee,
                2
            );

        $availabilityResult = $this->availabilityService->forInterval($start, $end, $data['type']);
        $availability = $availabilityResult['availability'];

        return response()->json([
            'quote' => [
                'base' => round($base, 2),
                'holiday_fee' => round($holidayFee, 2),
                'extra_fee' => round($extraFee, 2),
                'cleaning_fee' => round($cleaningFee, 2),
                'optional_fee' => round($optionalFee, 2),
                'bonfire' => round($data['bonfire_qty'] * (float) $settings['bonfire_price'], 2),
                'charcoal' => round($data['charcoal_qty'] * (float) $settings['charcoal_price'], 2),
                'liquor' => round(($data['liquor_qty'] ?? 0) * (float) $settings['liquor_price'], 2),
                'other' => 0,
                'total' => $total,
                'deposit' => (float) $settings['deposit'],
                'security_deposit' => (float) $settings['security_deposit'],
            ],

            'availability' => $availability,
            'queue_position' => $availabilityResult['queue_position'],
        ]);
    }
}
