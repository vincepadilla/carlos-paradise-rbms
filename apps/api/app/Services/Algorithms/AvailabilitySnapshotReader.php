<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

interface AvailabilitySnapshotReader
{
    /** Local connection/autocommit identity, without issuing SQL; null disallows comparison. */
    public function context(): ?string;

    /**
     * Identity of committed visibility in the supported connection context, or null.
     * Equal tokens must bound equivalent ordinary reads across intervening calls.
     * A row-content fingerprint is insufficient: changes can be reversed between reads.
     */
    public function read(): ?string;
}
