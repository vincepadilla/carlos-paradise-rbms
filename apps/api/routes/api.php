<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Auth\EmailVerificationController;

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'message' => 'Carlos Paradise RBMS API is running'
    ]);
});

Route::post('/register', [RegisterController::class, 'store'])
    ->middleware('throttle:5,1');

Route::prefix('email-verification')->group(function () {
    Route::post('/status', [EmailVerificationController::class, 'status'])
        ->middleware('throttle:60,1');
    Route::post('/verify', [EmailVerificationController::class, 'verify'])
        ->middleware('throttle:10,1');
    Route::post('/resend', [EmailVerificationController::class, 'resend'])
        ->middleware('throttle:5,1');
});
