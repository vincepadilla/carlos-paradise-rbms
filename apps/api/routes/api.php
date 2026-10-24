<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Auth\RegisterController;

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'message' => 'Carlos Paradise RBMS API is running'
    ]);
});

Route::post('/register', [RegisterController::class, 'store'])
    ->middleware('throttle:5,1');