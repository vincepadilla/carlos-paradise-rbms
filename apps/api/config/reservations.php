<?php

return [
    'receipt_root' => env('RESERVATION_RECEIPT_ROOT', storage_path('app/private/reservation-receipts')),
    // Roles with authority to verify a staff-recorded cash receipt immediately.
    'payment_approval_roles' => ['admin', 'owner'],
];
