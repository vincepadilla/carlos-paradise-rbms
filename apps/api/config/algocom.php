<?php

return [
    'availability_engine' => env('ALGOCOM_AVAILABILITY_ENGINE', 'sql'),
    'availability_shadow' => [
        'enabled' => env('ALGOCOM_AVAILABILITY_SHADOW_ENABLED', false),
    ],
];
