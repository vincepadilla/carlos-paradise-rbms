<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('availability_blocks', function (Blueprint $table) {
            $table->string('google_event_id')->nullable();
            $table->text('google_calendar_id')->nullable();
            $table->string('google_sync_hash', 64)->nullable();
            $table->timestampTz('google_synced_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('availability_blocks', function (Blueprint $table) {
            $table->dropColumn([
                'google_event_id',
                'google_calendar_id',
                'google_sync_hash',
                'google_synced_at',
            ]);
        });
    }
};