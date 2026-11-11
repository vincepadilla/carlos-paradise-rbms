<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class OwnerAudit
{
    public function record(User $user, string $action, string $module, string $details): void
    {
        DB::table('audit_events')->insert([
            'user_id' => $user->id, 'user_name' => $user->name,
            'role' => $user->role?->name ?? 'unknown',
            'action' => $action, 'module' => $module, 'details' => $details,
            'occurred_at' => now('Asia/Manila')->toIso8601String(),
        ]);
    }
}
