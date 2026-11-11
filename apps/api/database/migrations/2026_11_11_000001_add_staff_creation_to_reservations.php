<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->foreignId('created_by')->nullable()->after('user_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('liquor_qty')->default(0)->after('charcoal_qty');
            $table->decimal('liquor_amount_each', 12, 2)->default(0)->after('liquor_qty');
            $table->unique(['created_by', 'request_key'], 'reservations_creator_request_key_unique');
        });
    }

    public function down(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->dropUnique('reservations_creator_request_key_unique');
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn(['liquor_qty', 'liquor_amount_each']);
        });
    }
};
