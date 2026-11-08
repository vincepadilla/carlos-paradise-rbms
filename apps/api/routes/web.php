<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Auth\SessionAuthController;
use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\GuestProfileController;
use App\Http\Controllers\Auth\GoogleCalendarController;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/auth/login', [SessionAuthController::class, 'login'])
    ->middleware('throttle:5,1');

Route::get('/auth/user', [SessionAuthController::class, 'current'])
    ->middleware('throttle:60,1');

Route::post('/auth/logout', [SessionAuthController::class, 'logout'])
    ->middleware('throttle:20,1');

Route::get('/auth/google/redirect', [GoogleAuthController::class, 'redirect'])
    ->middleware('throttle:10,1');

Route::get('/auth/google/callback', [GoogleAuthController::class, 'callback'])
    ->middleware('throttle:20,1');

Route::get(
    '/api/settings',
    [
        \App\Http\Controllers\ReservationSettingsController::class,
        'index',
    ]
);

Route::get('/api/csrf', function () {
    return response()->json([
        'token' => csrf_token(),
    ]);
});

Route::post(
    '/api/quote',
    [
        \App\Http\Controllers\ReservationQuoteController::class,
        'quote',
    ]
)->middleware('auth');

Route::get(
    '/api/settings',
    [
        \App\Http\Controllers\ReservationSettingsController::class,
        'index',
    ]
);

Route::get('/api/csrf', function () {
    return response()->json([
        'token' => csrf_token(),
    ]);
});

Route::post(
    '/api/quote',
    [
        \App\Http\Controllers\ReservationQuoteController::class,
        'quote',
    ]
)->middleware('auth');

require __DIR__.'/reservations.php';
require __DIR__.'/admin.php';

Route::middleware('auth')->prefix('api')->group(function () {
    Route::get('profile', [GuestProfileController::class, 'show']);
    Route::patch('profile', [GuestProfileController::class, 'update'])
        ->middleware('throttle:20,1');
});

Route::middleware(['auth:web', 'throttle:10,1'])
    ->prefix('auth/google-calendar')
    ->group(function () {
        Route::get('/redirect', [
            GoogleCalendarController::class,
            'redirect',
        ])->name('google-calendar.redirect');

        Route::get('/callback', [
            GoogleCalendarController::class,
            'callback',
        ])->name('google-calendar.callback');
    });
