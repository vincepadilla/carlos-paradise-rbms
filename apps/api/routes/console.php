<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('calendar:sync-reservations')
    ->everyMinute()
    ->withoutOverlapping(60);

Schedule::command('calendar:sync-blocks')
    ->everyMinute()
    ->withoutOverlapping(60);
