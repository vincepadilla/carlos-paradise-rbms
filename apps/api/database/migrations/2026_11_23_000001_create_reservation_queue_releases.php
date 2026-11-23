<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reservation_queue_releases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('opportunity_id')->unique()->constrained('reservation_opportunities')->restrictOnDelete();
            $table->foreignId('villa_id')->constrained('villas')->restrictOnDelete();
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
            $table->timestampTz('decided_at');
            $table->unsignedBigInteger('queue_max_id');
            $table->foreignId('released_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('granted_reservation_id')->nullable()->constrained('reservations')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('approved_at')->nullable();
            $table->index(['villa_id', 'granted_reservation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reservation_queue_releases');
    }
};
