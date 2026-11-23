<?php

namespace App\Services\Algorithms;

use Illuminate\Database\Query\Builder;

final class ProtectedOpportunity
{
    /** A payment deadline can expire while its dates still await a staff release. */
    public static function whereUnreleased(Builder $held): void
    {
        $held->whereIn('reservations.status', ['held', 'awaiting_deposit', 'expired', 'cancelled'])
            ->whereExists(function (Builder $opportunity): void {
                $opportunity->selectRaw('1')->from('reservation_opportunities as opportunity')
                    ->whereColumn('opportunity.reservation_id', 'reservations.id')
                    ->whereIn('opportunity.status', ['active', 'expired'])
                    ->whereNotExists(function (Builder $newer): void {
                        $newer->selectRaw('1')->from('reservation_opportunities as newer')
                            ->whereColumn('newer.reservation_id', 'opportunity.reservation_id')
                            ->whereColumn('newer.id', '>', 'opportunity.id');
                    });
            });
    }
}
