<?php

use App\Services\AdminNotificationService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('calendar:sync-reservations')
    ->everyMinute()
    ->withoutOverlapping(60);

Schedule::command('audit:verify')->hourly()->withoutOverlapping(60);

Schedule::command('calendar:sync-blocks')
    ->everyMinute()
    ->withoutOverlapping(60);

Schedule::command('calendar:sync-ocular-visits')
    ->everyMinute()
    ->withoutOverlapping(60);

Schedule::call(fn () => app(AdminNotificationService::class)->syncOngoingStays())
    ->name('notifications:sync-ongoing-stays')
    ->everyMinute()
    ->withoutOverlapping(60);
