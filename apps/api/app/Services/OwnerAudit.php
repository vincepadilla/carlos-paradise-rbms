<?php

namespace App\Services;

use App\Models\User;

class OwnerAudit
{
    public function record(User $user, string $action, string $module, string $details, array $context = []): void
    {
        app(AuditChain::class)->append($user, $action, $module, $details, $context);
    }
}
