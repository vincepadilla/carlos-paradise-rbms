<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            Schema::hasTable('payment_methods') &&
            ! Schema::hasColumn('payment_methods', 'qr_code_url')
        ) {
            Schema::table('payment_methods', function (Blueprint $table) {
                $table->text('qr_code_url')
                    ->nullable()
                    ->after('account_number');
            });
        }

        DB::table('payment_methods')
            ->whereIn('name', ['GCash', 'MariBank'])
            ->update(['account_name' => 'Carlos Paradise']);
    }

    public function down(): void
    {
        if (
            Schema::hasTable('payment_methods') &&
            Schema::hasColumn('payment_methods', 'qr_code_url')
        ) {
            Schema::table('payment_methods', function (Blueprint $table) {
                $table->dropColumn('qr_code_url');
            });
        }
    }
};
