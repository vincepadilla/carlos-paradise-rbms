<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payment_methods', function (Blueprint $table) {
            $table->string('account_name')->nullable()->change();
            $table->string('account_number')->nullable()->change();
        });
        Schema::table('payments', function (Blueprint $table) {
            $table->string('receipt_storage_path')->nullable()->change();
            $table->uuid('request_key')->nullable()->after('staff_revision');
            $table->unique(['submitted_by', 'request_key'], 'payments_submitter_request_key_unique');
        });
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropUnique('payments_submitter_request_key_unique');
            $table->dropColumn('request_key');
        });
    }
};
