<?php

use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\GoogleAuthController;
use App\Http\Controllers\Auth\GoogleCalendarController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\SessionAuthController;
use App\Http\Controllers\GuestProfileController;
use App\Http\Controllers\ReservationAvailabilityController;
use App\Http\Controllers\ReservationQuoteController;
use App\Http\Controllers\ReservationSettingsController;
use App\Http\Middleware\RequireVerifiedGuestEmail;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::post('/auth/login', [SessionAuthController::class, 'login'])
    ->middleware('throttle:5,1');

Route::get('/auth/user', [SessionAuthController::class, 'current'])
    ->middleware('throttle:60,1');

Route::post('/auth/logout', [SessionAuthController::class, 'logout'])
    ->middleware('throttle:20,1');

Route::post('/api/register', [RegisterController::class, 'store'])
    ->middleware('throttle:5,1');

Route::prefix('api/email-verification')->group(function () {
    Route::post('/status', [EmailVerificationController::class, 'status'])
        ->middleware('throttle:60,1');
    Route::post('/verify', [EmailVerificationController::class, 'verify'])
        ->middleware('throttle:10,1');
    Route::post('/resend', [EmailVerificationController::class, 'resend'])
        ->middleware('throttle:5,1');
});

Route::get('/auth/google/redirect', [GoogleAuthController::class, 'redirect'])
    ->middleware('throttle:10,1');

Route::get('/auth/google/callback', [GoogleAuthController::class, 'callback'])
    ->middleware('throttle:20,1');

Route::get(
    '/api/settings',
    [
        ReservationSettingsController::class,
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
        ReservationQuoteController::class,
        'quote',
    ]
)->middleware(['auth', RequireVerifiedGuestEmail::class]);

Route::get(
    '/api/settings',
    [
        ReservationSettingsController::class,
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
        ReservationQuoteController::class,
        'quote',
    ]
)->middleware(['auth', RequireVerifiedGuestEmail::class]);

require __DIR__.'/reservations.php';
require __DIR__.'/admin.php';
require __DIR__.'/owner.php';

Route::get('/api/availability', [
    ReservationAvailabilityController::class,
    'index',
])->middleware(['auth', RequireVerifiedGuestEmail::class, 'throttle:60,1']);

Route::middleware(['auth', RequireVerifiedGuestEmail::class])->prefix('api')->group(function () {
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
