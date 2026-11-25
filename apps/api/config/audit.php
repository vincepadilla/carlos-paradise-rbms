<?php

return [
    // A trusted, independently protected checkpoint. Missing/unreadable configured files fail verification.
    'checkpoint_path' => env('AUDIT_CHECKPOINT_PATH'),
];
