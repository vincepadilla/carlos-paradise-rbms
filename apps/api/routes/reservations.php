<?php

use App\Http\Controllers\BookingPaymentsController;
use App\Http\Controllers\BookingReservationsController;
use App\Http\Controllers\QueueAllocationController;
use App\Http\Middleware\RequireAdminOrOwner;
use Illuminate\Support\Facades\Route;
use App\Http\Middleware\RequireVerifiedGuestEmail;

Route::prefix('api')->middleware(['auth', RequireVerifiedGuestEmail::class])->group(function () {
    Route::get('/reservations', [
        BookingReservationsController::class, 'index',
    ]);

    Route::post('/reservations', [
        BookingReservationsController::class, 'store',
    ])->middleware('throttle:20,1');

    Route::get('/reservations/{reservation}', [
        BookingReservationsController::class, 'show',
    ])->whereNumber('reservation');

    Route::post('/reservations/{reservation}/cancel', [
        BookingReservationsController::class, 'cancel',
    ])->whereNumber('reservation');

    Route::patch('/reservations/{reservation}/terms', [
        BookingReservationsController::class, 'terms',
    ])->whereNumber('reservation');

    Route::post('/reservations/{reservation}/opportunity', [
        BookingReservationsController::class, 'opportunity',
    ])->whereNumber('reservation')->middleware(RequireAdminOrOwner::class);

    Route::middleware(RequireAdminOrOwner::class)->group(function () {
        Route::post('/reservations/{reservation}/opportunity/release', [QueueAllocationController::class, 'release'])->whereNumber('reservation');
        Route::post('/reservations/{reservation}/opportunity/extend', [QueueAllocationController::class, 'extend'])->whereNumber('reservation');
        Route::post('/v1/algorithm/solve', [QueueAllocationController::class, 'solve']);
    });

    Route::post('/reservations/{reservation}/extension', [
        BookingReservationsController::class, 'requestExtension',
    ])->whereNumber('reservation')->middleware('throttle:10,1');

    Route::post('/reservations/{reservation}/extension/review', [
        BookingReservationsController::class, 'reviewExtension',
    ])->whereNumber('reservation');

    Route::post('/reservations/{reservation}/payments', [
        BookingPaymentsController::class, 'store',
    ])->whereNumber('reservation')->middleware('throttle:10,1');

    Route::get('/payments/{payment}/receipt', [
        BookingPaymentsController::class, 'receipt',
    ])->whereNumber('payment');

    Route::post('/payments/{payment}/review', [
        BookingPaymentsController::class, 'review',
    ])->whereNumber('payment')->middleware(\App\Http\Middleware\RequireAdmin::class);
});
