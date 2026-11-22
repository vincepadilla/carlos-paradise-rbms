<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

enum ReservationIntervalMode: string
{
    case Current = 'current';
    case Pbl = 'pbl';
}
