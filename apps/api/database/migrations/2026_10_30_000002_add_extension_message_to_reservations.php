<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            Schema::hasTable('reservations') &&
            ! Schema::hasColumn('reservations', 'extension_message')
        ) {
            Schema::table('reservations', function (Blueprint $table) {
                $table->text('extension_message')
                    ->nullable()
                    ->after('extension_reason');
            });
        }
    }

    public function down(): void
    {
        if (
            Schema::hasTable('reservations') &&
            Schema::hasColumn('reservations', 'extension_message')
        ) {
            Schema::table('reservations', function (Blueprint $table) {
                $table->dropColumn('extension_message');
            });
        }
    }
};
