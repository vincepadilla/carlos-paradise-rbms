<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ocular_visits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('villa_id')->constrained('villas')->restrictOnDelete();
            $table->string('guest_name');
            $table->string('contact_details');
            $table->date('visit_date');
            $table->time('start_time');
            $table->time('end_time');
            $table->string('status', 30)->default('pending_review');
            $table->string('inquiry_source', 60)->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->index(['villa_id', 'visit_date', 'start_time']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ocular_visits');
    }
};
