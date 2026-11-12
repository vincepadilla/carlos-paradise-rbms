<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmailVerificationCode extends Model
{
    protected $guarded = [];

    protected $hidden = ['access_token_hash', 'code_hash'];

    protected function casts(): array
    {
        return [
            'last_sent_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'resend_available_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
