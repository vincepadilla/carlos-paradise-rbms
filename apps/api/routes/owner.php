<?php

use App\Http\Controllers\Owner\OwnerAdminsController;
use App\Http\Controllers\Owner\OwnerAuditController;
use App\Http\Controllers\Owner\OwnerDatabaseController;
use App\Http\Controllers\Owner\OwnerDocumentsController;
use App\Http\Controllers\Owner\OwnerSettingsController;
use App\Http\Middleware\RequireOwner;
use App\Http\Middleware\AuditStaffMutation;
use Illuminate\Support\Facades\Route;

Route::prefix('api/owner')->middleware(['auth:web', RequireOwner::class, AuditStaffMutation::class])->group(function () {
    Route::get('/settings', [OwnerSettingsController::class, 'index']);
    Route::patch('/settings', [OwnerSettingsController::class, 'update'])->middleware('throttle:30,1');
    Route::get('/payment-methods', [OwnerSettingsController::class, 'paymentMethods']);
    Route::post('/payment-methods', [OwnerSettingsController::class, 'savePaymentMethod'])->middleware('throttle:20,1');
    Route::get('/admins', [OwnerAdminsController::class, 'index']);
    Route::post('/admins', [OwnerAdminsController::class, 'store'])->middleware('throttle:10,1');
    Route::patch('/admins/{admin}', [OwnerAdminsController::class, 'update'])->whereNumber('admin')->middleware('throttle:20,1');
    Route::get('/documents', [OwnerDocumentsController::class, 'index']);
    Route::post('/documents', [OwnerDocumentsController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/documents/{document}/download', [OwnerDocumentsController::class, 'download'])->whereNumber('document');
    Route::get('/audit-trail', [OwnerAuditController::class, 'index']);
    Route::get('/database/backup', [OwnerDatabaseController::class, 'download'])->middleware('throttle:5,1');
    Route::post('/database/validate', [OwnerDatabaseController::class, 'validateBackup'])->middleware('throttle:10,1');
});
