<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('villas', function (Blueprint $table) {
            $table->id();

            $table->string('name');
            $table->text('description')->nullable();
            $table->text('address');
            $table->string('timezone', 60)->default('Asia/Manila');

            // Rates and guest limits
            $table->decimal('base_nightly_rate', 12, 2)->default(16000);
            $table->unsignedInteger('included_guests')->default(20);
            $table->unsignedInteger('maximum_guests')->default(40);
            $table->decimal('extra_guest_rate', 12, 2)->default(500);
            $table->decimal('child_guest_weight', 4, 2)->default(1);

            // Pets
            $table->unsignedInteger('pet_limit')->default(10);
            $table->decimal('pet_fee', 12, 2)->default(0);

            // Overnight schedule
            $table->time('check_in_time')->default('14:00:00');
            $table->time('check_out_time')->default('11:00:00');

            // Reservation deposit
            $table->decimal('deposit_amount', 12, 2)->default(5000);
            $table->unsignedInteger('deposit_window_hours')->default(24);

            // Additional pricing and policy settings
            $table->json('settings')->nullable();

            $table->boolean('is_active')->default(true);

            $table->timestamps();
        });

        Schema::create('reservations', function (Blueprint $table) {
            $table->id();

            $table->string('booking_reference', 40)->unique();

            $table->foreignId('user_id')
                ->constrained('users')
                ->restrictOnDelete();

            $table->foreignId('villa_id')
                ->constrained('villas')
                ->restrictOnDelete();

            // Booking contact details, saved separately from the profile
            $table->string('contact_name');
            $table->string('contact_email');
            $table->string('contact_phone', 30);

            // overnight or day_tour
            $table->string('type', 20)->default('overnight');

            $table->date('check_in_date');
            $table->date('check_out_date');

            // Full timestamps support same-day tours and overlap checks
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');

            // Guest information
            $table->unsignedInteger('adults');
            $table->unsignedInteger('children')->default(0);
            $table->unsignedInteger('pets')->default(0);

            // Optional items from your form
            $table->unsignedInteger('bonfire_qty')->default(0);
            $table->unsignedInteger('charcoal_qty')->default(0);

            $table->string('inquiry_source', 100);
            $table->text('special_requests')->nullable();

            /*
             * pending
             * queued
             * awaiting_deposit
             * payment_review
             * confirmed
             * cancelled
             * rejected
             * expired
             * completed
             */
            $table->string('status', 30)->default('pending');

            // Amounts are calculated by Laravel
            $table->decimal('quoted_total', 12, 2)->default(0);
            $table->decimal('required_deposit', 12, 2)->default(5000);
            $table->string('currency', 3)->default('PHP');

            // Day-tour total remains provisional until staff agree a price
            $table->boolean('price_agreed')->default(false);

            // Preserve the prices and policies accepted for this booking
            $table->json('pricing_snapshot');
            $table->json('policy_snapshot');

            $table->timestampTz('requested_at');
            $table->unsignedInteger('deposit_window_hours')->default(24);
            $table->timestampTz('deadline')->nullable();

            // Deposit deadline extension
            $table->timestampTz('extension_date')->nullable();
            $table->text('extension_reason')->nullable();
            $table->string('extension_status', 20)->nullable();

            // Staff processing information
            $table->foreignId('processed_by')
                ->nullable()
                ->constrained('users')
                ->restrictOnDelete();

            $table->timestampTz('processed_at')->nullable();

            // Prevent duplicate requests after a lost network response
            $table->uuid('request_key')->nullable();

            $table->timestamps();

            $table->unique(['user_id', 'request_key']);

            $table->index(['user_id', 'status']);
            $table->index(['villa_id', 'status']);
            $table->index(['villa_id', 'starts_at', 'ends_at']);
            $table->index('deadline');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reservations');
        Schema::dropIfExists('villas');
    }
};