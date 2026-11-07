<?php

use App\Http\Controllers\Admin\AdminAvailabilityBlocksController;
use App\Http\Controllers\Admin\AdminCalendarController;
use App\Http\Controllers\Admin\AdminExtensionAccessController;
use App\Http\Controllers\Admin\AdminGuestsController;
use App\Http\Controllers\Admin\AdminPaymentReviewController;
use App\Http\Controllers\Admin\AdminReservationManagementController;
use App\Http\Middleware\RequireAdmin;
use App\Http\Middleware\RequireAdminOrOwner;
use Illuminate\Support\Facades\Route;

// These routes use the same web session and CSRF stack as reservations.
Route::prefix('api/admin')->middleware(['auth:web', RequireAdmin::class])->group(function () {
    Route::patch('/reservations/{reservation}', [AdminReservationManagementController::class, 'update'])->whereNumber('reservation')->middleware('throttle:30,1');
    Route::post('/reservations/{reservation}/complete', [AdminReservationManagementController::class, 'complete'])->whereNumber('reservation')->middleware('throttle:30,1');
    Route::post('/reservations/{reservation}/extension-access', [AdminExtensionAccessController::class, 'store'])->whereNumber('reservation')->middleware('throttle:30,1');
    Route::delete('/reservations/{reservation}/extension-access', [AdminExtensionAccessController::class, 'destroy'])->whereNumber('reservation')->middleware('throttle:30,1');
    Route::get('/payment-reviews', [AdminPaymentReviewController::class, 'index']);
    Route::get('/reservations/{reservation}/payment-review', [AdminPaymentReviewController::class, 'show'])->whereNumber('reservation');
    Route::post('/reservations/{reservation}/payments/{payment}/review', [AdminPaymentReviewController::class, 'review'])->whereNumber(['reservation', 'payment'])->middleware('throttle:30,1');
    Route::get('/reservations/{reservation}/payments/{payment}/receipt', [AdminPaymentReviewController::class, 'receipt'])->whereNumber(['reservation', 'payment']);
    Route::get('/calendar', [AdminCalendarController::class, 'index']);
    Route::get('/guests', [AdminGuestsController::class, 'index']);
    Route::get('/guests/{guest}', [AdminGuestsController::class, 'show'])->whereNumber('guest');
    Route::get('/availability-blocks', [AdminAvailabilityBlocksController::class, 'index']);
    Route::post('/availability-blocks', [AdminAvailabilityBlocksController::class, 'store'])->middleware('throttle:20,1');
    Route::patch('/availability-blocks/{block}', [AdminAvailabilityBlocksController::class, 'update'])->whereNumber('block')->middleware('throttle:20,1');
    Route::post('/availability-blocks/{block}/release', [AdminAvailabilityBlocksController::class, 'release'])->whereNumber('block')->middleware('throttle:20,1');
});

Route::prefix('api/admin')->middleware(['auth:web', RequireAdminOrOwner::class])->group(function () {
    Route::patch('/guests/{guest}', [AdminGuestsController::class, 'update'])
        ->whereNumber('guest')
        ->middleware('throttle:30,1');
});
