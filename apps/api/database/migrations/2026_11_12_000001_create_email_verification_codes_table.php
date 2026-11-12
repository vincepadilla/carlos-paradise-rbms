<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_verification_codes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('purpose', 50);
            $table->char('access_token_hash', 64)->unique();
            $table->string('code_hash');
            $table->uuid('generation')->unique();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedSmallInteger('max_attempts')->default(5);
            $table->string('delivery_status', 20)->default('queued');
            $table->timestampTz('last_sent_at')->nullable();
            $table->timestampTz('expires_at');
            $table->timestampTz('resend_available_at');
            $table->timestampTz('consumed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['user_id', 'purpose']);
            $table->index(['purpose', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_verification_codes');
    }
};
