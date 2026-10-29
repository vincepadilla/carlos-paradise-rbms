<?php

namespace App\Console\Commands;

use App\Http\Controllers\BookingReservationsController;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Http\Request;

class GrantBookingOpportunity extends Command
{
    protected $signature =
        'reservations:grant
        {reservation : Reservation ID}
        {staff_user_id : Existing admin or owner user ID}
        {--total= : Staff-agreed total for a day tour}';

    protected $description =
        'Grant a deposit opportunity using an existing staff account';

    public function handle(
        BookingReservationsController $controller
    ): int {
        $reservationId = (int) $this->argument(
            'reservation'
        );

        $actor = User::findOrFail(
            $this->argument('staff_user_id')
        );

        /*
         * For day tours, staff must agree the final total
         * before granting the deposit opportunity.
         */
        if ($this->option('total') !== null) {
            $termsRequest = Request::create(
                "/api/reservations/{$reservationId}/terms",
                'PATCH',
                [
                    'total' => $this->option('total'),
                ]
            );

            $termsRequest->setUserResolver(
                fn () => $actor
            );

            $controller->terms(
                $termsRequest,
                $reservationId
            );
        }

        $request = Request::create(
            "/api/reservations/{$reservationId}/opportunity",
            'POST'
        );

        $request->setUserResolver(
            fn () => $actor
        );

        // The controller still verifies the staff role.
        $response = $controller->opportunity(
            $request,
            $reservationId
        );

        $this->info(
            'Deposit opportunity granted successfully.'
        );

        $this->line(
            json_encode(
                $response->getData(true),
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
            )
        );

        return self::SUCCESS;
    }
}