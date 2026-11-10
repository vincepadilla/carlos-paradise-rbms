<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_notifications', function (Blueprint $table) {
            $table->id();
            $table->string('event_key', 190)->unique();
            $table->string('type', 60);
            $table->string('title');
            $table->text('description');
            $table->foreignId('reservation_id')->nullable()->constrained('reservations')->restrictOnDelete();
            $table->string('destination');
            $table->timestampTz('occurred_at');
            $table->timestamps();
            $table->index(['occurred_at', 'id']);
        });

        Schema::create('admin_notification_recipients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('notification_id')->constrained('admin_notifications')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestampTz('read_at')->nullable();
            $table->timestamps();
            $table->unique(['notification_id', 'user_id']);
            $table->index(['user_id', 'read_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_notification_recipients');
        Schema::dropIfExists('admin_notifications');
    }
};
