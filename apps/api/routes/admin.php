<?php

use App\Http\Controllers\Admin\AdminAvailabilityBlocksController;
use App\Http\Controllers\Admin\AdminCalendarController;
use App\Http\Controllers\Admin\AdminDashboardController;
use App\Http\Controllers\Admin\AdminExtensionAccessController;
use App\Http\Controllers\Admin\AdminGuestsController;
use App\Http\Controllers\Admin\AdminNotificationsController;
use App\Http\Controllers\Admin\AdminOcularVisitsController;
use App\Http\Controllers\Admin\AdminOcularVisitReportsController;
use App\Http\Controllers\Admin\AdminOutgoingEmailsController;
use App\Http\Controllers\Admin\AdminPaymentReviewController;
use App\Http\Controllers\Admin\AdminPaymentReportsController;
use App\Http\Controllers\Admin\AdminQueueReportsController;
use App\Http\Controllers\Admin\AdminReservationManagementController;
use App\Http\Controllers\Admin\AdminReservationCreationController;
use App\Http\Controllers\Admin\AdminReservationReportsController;
use App\Http\Middleware\RequireAdmin;
use App\Http\Middleware\RequireOwner;
use App\Http\Middleware\RequireAdminOrOwner;
use Illuminate\Support\Facades\Route;

// These routes use the same web session and CSRF stack as reservations.
foreach (['api/admin' => RequireAdmin::class, 'api/owner/operations' => RequireOwner::class] as $prefix => $authorization) {
    Route::prefix($prefix)->middleware(['auth:web', $authorization])->group(function () {
        Route::get('/dashboard/summary', [AdminDashboardController::class, 'summary']);
        Route::get('/reservations', [AdminReservationManagementController::class, 'index']);
        Route::get('/reports/reservations', [AdminReservationReportsController::class, 'index']);
        Route::get('/reports/reservations/print', [AdminReservationReportsController::class, 'printData']);
        Route::get('/reports/reservations/export', [AdminReservationReportsController::class, 'export']);
        Route::get('/reports/guests', [AdminReservationReportsController::class, 'guestIndex']);
        Route::get('/reports/guests/print', [AdminReservationReportsController::class, 'guestPrintData']);
        Route::get('/reports/guests/export', [AdminReservationReportsController::class, 'guestExport']);
        Route::get('/reports/payments', [AdminPaymentReportsController::class, 'index']);
        Route::get('/reports/payments/print', [AdminPaymentReportsController::class, 'printData']);
        Route::get('/reports/payments/export', [AdminPaymentReportsController::class, 'export']);
        Route::get('/reports/queue', [AdminQueueReportsController::class, 'index']);
        Route::get('/reports/queue/print', [AdminQueueReportsController::class, 'printData']);
        Route::get('/reports/queue/export', [AdminQueueReportsController::class, 'export']);
        Route::get('/reports/ocular-visits', [AdminOcularVisitReportsController::class, 'index']);
        Route::get('/reports/ocular-visits/print', [AdminOcularVisitReportsController::class, 'printData']);
        Route::get('/reports/ocular-visits/export', [AdminOcularVisitReportsController::class, 'export']);
        Route::patch('/reservations/{reservation}', [AdminReservationManagementController::class, 'update'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::post('/reservations/{reservation}/complete', [AdminReservationManagementController::class, 'complete'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::post('/reservations/{reservation}/extension-access', [AdminExtensionAccessController::class, 'store'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::delete('/reservations/{reservation}/extension-access', [AdminExtensionAccessController::class, 'destroy'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::get('/payment-reviews', [AdminPaymentReviewController::class, 'index']);
        Route::get('/reservations/{reservation}/payment-review', [AdminPaymentReviewController::class, 'show'])->whereNumber('reservation');
        Route::patch('/reservations/{reservation}/payment-review/reservation', [AdminPaymentReviewController::class, 'updateReservation'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::patch('/reservations/{reservation}/payment-review/deposit-terms', [AdminPaymentReviewController::class, 'updateTerms'])->whereNumber('reservation')->middleware('throttle:30,1');
        Route::post('/reservations/{reservation}/payments/{payment}/edit', [AdminPaymentReviewController::class, 'updatePayment'])->whereNumber(['reservation', 'payment'])->middleware('throttle:30,1');
        Route::post('/reservations/{reservation}/payment-review/cash-payments', [AdminPaymentReviewController::class, 'recordCash'])->whereNumber('reservation')->middleware('throttle:20,1');
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

}

foreach (['api/admin' => RequireAdminOrOwner::class, 'api/owner/operations' => RequireOwner::class] as $prefix => $authorization) {
    Route::prefix($prefix)->middleware(['auth:web', $authorization])->group(function () {
        Route::get('/reservation-create/options', [AdminReservationCreationController::class, 'options']);
        Route::get('/reservation-create/guests', [AdminReservationCreationController::class, 'guests'])->middleware('throttle:60,1');
        Route::post('/reservation-create/preview', [AdminReservationCreationController::class, 'preview'])->middleware('throttle:30,1');
        Route::post('/reservations', [AdminReservationCreationController::class, 'store'])->middleware('throttle:20,1');
        Route::get('/notifications', [AdminNotificationsController::class, 'index']);
        Route::get('/notifications/unread-count', [AdminNotificationsController::class, 'unreadCount']);
        Route::post('/notifications/{notification}/read', [AdminNotificationsController::class, 'markAsRead'])->whereNumber('notification')->middleware('throttle:60,1');
        Route::get('/email-compose-options', [AdminOutgoingEmailsController::class, 'options']);
        Route::get('/email-recipients', [AdminOutgoingEmailsController::class, 'recipients']);
        Route::get('/outgoing-emails', [AdminOutgoingEmailsController::class, 'index']);
        Route::get('/outgoing-emails/{outgoingEmail}', [AdminOutgoingEmailsController::class, 'show'])->whereNumber('outgoingEmail');
        Route::post('/outgoing-emails/send', [AdminOutgoingEmailsController::class, 'send'])->middleware('throttle:20,1');
        Route::post('/outgoing-emails/schedule', [AdminOutgoingEmailsController::class, 'schedule'])->middleware('throttle:20,1');
        Route::get('/ocular-visits/suggested-slot', [AdminOcularVisitsController::class, 'suggestedSlot']);
        Route::post('/ocular-visits', [AdminOcularVisitsController::class, 'store'])->middleware('throttle:20,1');
        Route::get('/ocular-visits/{ocularVisit}', [AdminOcularVisitsController::class, 'show'])->whereNumber('ocularVisit');
        Route::patch('/ocular-visits/{ocularVisit}', [AdminOcularVisitsController::class, 'update'])->whereNumber('ocularVisit')->middleware('throttle:20,1');
        Route::post('/ocular-visits/{ocularVisit}/approve', [AdminOcularVisitsController::class, 'approve'])->whereNumber('ocularVisit')->middleware('throttle:20,1');
        Route::post('/ocular-visits/{ocularVisit}/cancel', [AdminOcularVisitsController::class, 'cancel'])->whereNumber('ocularVisit')->middleware('throttle:20,1');
        Route::patch('/guests/{guest}', [AdminGuestsController::class, 'update'])
            ->whereNumber('guest')
            ->middleware('throttle:30,1');
    });

}
