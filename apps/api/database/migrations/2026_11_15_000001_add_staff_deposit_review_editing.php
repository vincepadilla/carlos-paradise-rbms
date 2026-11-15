<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->string('creation_source', 30)->default('guest_portal')->after('created_by');
            $table->boolean('partial_payment_authorized')->default(false)->after('required_deposit');
            $table->text('partial_payment_terms')->nullable()->after('partial_payment_authorized');
        });

        DB::table('reservations')->whereNotNull('created_by')->update(['creation_source' => 'staff_portal']);

        Schema::table('payments', function (Blueprint $table) {
            $table->text('staff_notes')->nullable()->after('payment_date');
            $table->unsignedInteger('staff_revision')->default(0)->after('staff_notes');
        });

        Schema::create('payment_adjustments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payment_id')->constrained('payments')->restrictOnDelete();
            $table->foreignId('reservation_id')->constrained('reservations')->restrictOnDelete();
            $table->foreignId('adjusted_by')->constrained('users')->restrictOnDelete();
            $table->text('reason');
            $table->json('before_values');
            $table->json('after_values');
            $table->string('previous_receipt_storage_path')->nullable();
            $table->timestampTz('adjusted_at');
            $table->timestamps();
            $table->index(['reservation_id', 'payment_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_adjustments');
        Schema::table('payments', fn (Blueprint $table) => $table->dropColumn(['staff_notes', 'staff_revision']));
        Schema::table('reservations', fn (Blueprint $table) => $table->dropColumn(['creation_source', 'partial_payment_authorized', 'partial_payment_terms']));
    }
};
