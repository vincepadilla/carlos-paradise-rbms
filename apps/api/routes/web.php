<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Auth\SessionAuthController;
use App\Http\Controllers\Auth\GoogleAuthController;

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