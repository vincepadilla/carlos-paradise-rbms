<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->text('contact_address')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->unsignedInteger('admin_revision')->default(0);
        });
        Schema::table('reservation_status_history', function (Blueprint $table) {
            $table->string('event', 80)->nullable();
            $table->json('changes')->nullable();
        });
        Schema::create('reservation_extension_access', function (Blueprint $table) {
            $table->id();
            $table->foreignId('reservation_id')->unique()->constrained('reservations')->restrictOnDelete();
            $table->boolean('enabled')->default(false);
            $table->timestampTz('agreed_deadline');
            $table->foreignId('granted_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('granted_at');
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampTz('consumed_at')->nullable();
            $table->timestamps();
        });
        Schema::create('reservation_damages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('reservation_id')->constrained('reservations')->restrictOnDelete();
            $table->string('description', 1000);
            $table->string('item_area');
            $table->decimal('amount', 12, 2);
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('updated_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('deleted_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestampTz('deleted_at')->nullable();
            $table->timestamps();
            $table->index(['reservation_id', 'deleted_at']);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('This additive management migration preserves financial history and cannot be rolled back automatically.');
    }
};
