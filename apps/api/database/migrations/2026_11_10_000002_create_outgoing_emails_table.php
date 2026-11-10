<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('outgoing_emails', function (Blueprint $table) {
            $table->id();
            $table->uuid('idempotency_key');
            $table->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('recipient_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('reservation_id')->constrained('reservations')->restrictOnDelete();
            $table->string('recipient_name');
            $table->string('recipient_email');
            $table->string('category', 50);
            $table->string('subject', 200);
            $table->text('message');
            $table->json('attachments')->nullable();
            $table->string('status', 20);
            $table->timestampTz('scheduled_for')->nullable();
            $table->timestampTz('queued_at')->nullable();
            $table->timestampTz('processing_at')->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('failed_at')->nullable();
            $table->text('failure_message')->nullable();
            $table->timestamps();
            $table->unique(['sender_id', 'idempotency_key']);
            $table->index(['status', 'scheduled_for']);
            $table->index(['created_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('outgoing_emails');
    }
};
