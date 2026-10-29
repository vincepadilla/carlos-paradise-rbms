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
            !Schema::hasTable('villas') ||
            !Schema::hasTable('reservations')
        ) {
            throw new RuntimeException(
                'Create the villas and reservations tables first.'
            );
        }

        /*
         * Receiving accounts displayed to guests.
         */
        if (!Schema::hasTable('payment_methods')) {
            Schema::create('payment_methods', function (Blueprint $table) {
                $table->id();

                $table->string('name');
                $table->string('account_name');
                $table->string('account_number');
                $table->text('instructions')->nullable();

                $table->boolean('is_active')->default(true);

                $table->timestamps();

                $table->unique([
                    'name',
                    'account_number',
                ]);
            });
        }

        /*
         * Periods when the villa cannot accept reservations.
         * ends_on is exclusive.
         */
        if (!Schema::hasTable('availability_blocks')) {
            Schema::create('availability_blocks', function (Blueprint $table) {
                $table->id();

                $table->foreignId('villa_id')
                    ->constrained('villas')
                    ->restrictOnDelete();

                $table->date('starts_on');
                $table->date('ends_on');

                $table->text('reason');

                $table->foreignId('created_by')
                    ->constrained('users')
                    ->restrictOnDelete();

                $table->timestampTz('released_at')->nullable();

                $table->timestamps();

                $table->index([
                    'villa_id',
                    'starts_on',
                    'ends_on',
                ]);
            });
        }

        /*
         * Staff-granted opportunities to submit a deposit.
         */
        if (!Schema::hasTable('reservation_opportunities')) {
            Schema::create(
                'reservation_opportunities',
                function (Blueprint $table) {
                    $table->id();

                    $table->foreignId('reservation_id')
                        ->constrained('reservations')
                        ->restrictOnDelete();

                    $table->timestampTz('granted_at');
                    $table->timestampTz('deposit_deadline');
                    $table->timestampTz('closed_at')->nullable();

                    // active, completed, expired, or revoked
                    $table->string('status', 30)
                        ->default('active');

                    $table->foreignId('granted_by')
                        ->nullable()
                        ->constrained('users')
                        ->restrictOnDelete();

                    $table->timestamps();

                    $table->index([
                        'reservation_id',
                        'status',
                    ]);
                }
            );

            // PostgreSQL: only one active opportunity per reservation.
            if (DB::getDriverName() === 'pgsql') {
                DB::statement(
                    "CREATE UNIQUE INDEX
                    reservation_opportunities_one_active_idx
                    ON reservation_opportunities (reservation_id)
                    WHERE status = 'active'"
                );
            }
        }

        /*
         * Submitted transfer details and private receipt paths.
         */
        if (!Schema::hasTable('payments')) {
            Schema::create('payments', function (Blueprint $table) {
                $table->id();

                $table->foreignId('reservation_id')
                    ->constrained('reservations')
                    ->restrictOnDelete();

                $table->foreignId('opportunity_id')
                    ->nullable()
                    ->constrained('reservation_opportunities')
                    ->restrictOnDelete();

                $table->foreignId('payment_method_id')
                    ->constrained('payment_methods')
                    ->restrictOnDelete();

                $table->string('payment_kind', 20)
                    ->default('deposit');

                $table->decimal('amount', 12, 2);

                $table->string('currency', 3)
                    ->default('PHP');

                $table->string('reference_number');
                $table->string('receipt_storage_path');

                $table->date('payment_date')->nullable();
                $table->timestampTz('submitted_at');

                // submitted, approved, or rejected
                $table->string('status', 30)
                    ->default('submitted');

                $table->foreignId('submitted_by')
                    ->constrained('users')
                    ->restrictOnDelete();

                $table->timestamps();

                $table->unique([
                    'payment_method_id',
                    'reference_number',
                ]);
            });
        } elseif (!Schema::hasColumn('payments', 'payment_date')) {
            Schema::table('payments', function (Blueprint $table) {
                $table->date('payment_date')->nullable();
            });
        }

        /*
         * Staff decisions about submitted receipts.
         */
        if (!Schema::hasTable('payment_reviews')) {
            Schema::create('payment_reviews', function (Blueprint $table) {
                $table->id();

                $table->foreignId('payment_id')
                    ->constrained('payments')
                    ->restrictOnDelete();

                $table->foreignId('reviewed_by')
                    ->constrained('users')
                    ->restrictOnDelete();

                $table->string('decision', 30);
                $table->text('notes')->nullable();
                $table->timestampTz('reviewed_at');

                $table->timestamps();
            });
        }

        /*
         * Reservation status changes.
         */
        if (!Schema::hasTable('reservation_status_history')) {
            Schema::create(
                'reservation_status_history',
                function (Blueprint $table) {
                    $table->id();

                    $table->foreignId('reservation_id')
                        ->constrained('reservations')
                        ->restrictOnDelete();

                    $table->string('from_status', 30)->nullable();
                    $table->string('to_status', 30);

                    $table->foreignId('changed_by')
                        ->nullable()
                        ->constrained('users')
                        ->restrictOnDelete();

                    $table->text('reason')->nullable();
                    $table->timestampTz('changed_at');

                    $table->timestamps();
                }
            );
        }
    }

    public function down(): void
    {
        /*
         * Intentionally preserve payment and reservation history.
         * This migration may reuse tables that already existed.
         */
    }
};