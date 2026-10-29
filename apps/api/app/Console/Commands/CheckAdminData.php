<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CheckAdminData extends Command
{
    protected $signature = 'admin:check-data';

    protected $description =
        'Read-only checks for reservation admin database readiness';

    public function handle(): int
    {
        $errors = 0;
        $warnings = 0;

        try {
            DB::connection()->getPdo();

            $this->info('Database connection: OK');

            // Fields used by reservation and payment admin screens.
            $required = [
                'users' => [
                    'id',
                    'name',
                    'email',
                ],
                'reservations' => [
                    'id',
                    'booking_reference',
                    'user_id',
                    'contact_name',
                    'contact_email',
                    'contact_phone',
                    'starts_at',
                    'ends_at',
                    'status',
                    'quoted_total',
                    'required_deposit',
                    'deadline',
                    'processed_by',
                    'processed_at',
                    'created_at',
                    'updated_at',
                ],
                'payments' => [
                    'id',
                    'reservation_id',
                    'payment_method_id',
                    'amount',
                    'status',
                ],
                'payment_methods' => [
                    'id',
                    'name',
                ],
                'payment_reviews' => [
                    'id',
                    'payment_id',
                ],
                'reservation_opportunities' => [
                    'id',
                    'reservation_id',
                    'status',
                ],
            ];

            $rows = [];
            $schemaReady = true;

            foreach ($required as $table => $columns) {
                if (! Schema::hasTable($table)) {
                    $rows[] = [$table, 'MISSING TABLE', '-', '-'];
                    $errors++;
                    $schemaReady = false;

                    continue;
                }

                $existing = Schema::getColumnListing($table);
                $missing = array_values(array_diff($columns, $existing));
                $count = DB::table($table)->count();

                $rows[] = [
                    $table,
                    $missing === [] ? 'OK' : 'MISSING COLUMNS',
                    $count,
                    $missing === [] ? '-' : implode(', ', $missing),
                ];

                if ($missing !== []) {
                    $errors++;
                    $schemaReady = false;
                }

                if ($count === 0) {
                    $warnings++;
                    $this->warn(
                        "{$table} is empty. Its admin list should show an empty state."
                    );
                }
            }

            $this->newLine();

            $this->table(
                ['Table', 'Schema', 'Records', 'Missing columns'],
                $rows
            );

            if (! $schemaReady) {
                $this->error(
                    'Resolve the missing tables or columns, then run this command again.'
                );

                return self::FAILURE;
            }

            // Relationships must resolve for admin detail screens.
            $relationships = [
                ['reservations', 'user_id', 'users'],
                ['payments', 'reservation_id', 'reservations'],
                ['payments', 'payment_method_id', 'payment_methods'],
                ['payment_reviews', 'payment_id', 'payments'],
                [
                    'reservation_opportunities',
                    'reservation_id',
                    'reservations',
                ],
            ];

            $this->newLine();
            $this->info('Relationship checks');

            foreach ($relationships as [$child, $foreignKey, $parent]) {
                $count = DB::table("{$child} as child")
                    ->leftJoin(
                        "{$parent} as parent",
                        "child.{$foreignKey}",
                        '=',
                        'parent.id'
                    )
                    ->whereNotNull("child.{$foreignKey}")
                    ->whereNull('parent.id')
                    ->count();

                if ($count > 0) {
                    $errors++;

                    $this->error(
                        "{$child}.{$foreignKey}: {$count} orphaned record(s)"
                    );
                } else {
                    $this->line("OK: {$child}.{$foreignKey} → {$parent}.id");
                }
            }

            // Sanity checks for values shown in the admin interface.
            $invalidDates = DB::table('reservations')
                ->where(function ($query) {
                    $query->whereNull('starts_at')
                        ->orWhereNull('ends_at')
                        ->orWhereColumn('ends_at', '<=', 'starts_at');
                })
                ->count();

            $invalidPayments = DB::table('payments')
                ->where(function ($query) {
                    $query->whereNull('amount')
                        ->orWhere('amount', '<=', 0);
                })
                ->count();

            $missingReferences = DB::table('reservations')
                ->where(function ($query) {
                    $query->whereNull('booking_reference')
                        ->orWhere('booking_reference', '');
                })
                ->count();

            foreach ([
                'Reservations with invalid dates' => $invalidDates,
                'Payments with invalid amounts' => $invalidPayments,
                'Reservations without booking references' => $missingReferences,
            ] as $label => $count) {
                if ($count > 0) {
                    $errors++;
                    $this->error("{$label}: {$count}");
                } else {
                    $this->line("OK: {$label}: 0");
                }
            }

            // Detect a possible result of manually changing reservation status.
            $confirmedWithoutPayment = DB::table('reservations as r')
                ->where('r.status', 'confirmed')
                ->whereNotExists(function ($query) {
                    $query->selectRaw('1')
                        ->from('payments as p')
                        ->whereColumn('p.reservation_id', 'r.id')
                        ->where('p.status', 'approved');
                })
                ->count();

            if ($confirmedWithoutPayment > 0) {
                $warnings++;

                $this->warn(
                    "{$confirmedWithoutPayment} confirmed reservation(s) have no approved payment. Review these records."
                );
            }

            $this->newLine();
            $this->info('Reservation status summary');

            $this->table(
                ['Status', 'Records'],
                DB::table('reservations')
                    ->select('status')
                    ->selectRaw('COUNT(*) as total')
                    ->groupBy('status')
                    ->orderBy('status')
                    ->get()
                    ->map(fn ($row) => [
                        $row->status ?? '(NULL)',
                        $row->total,
                    ])
                    ->all()
            );

            $this->info('Payment status summary');

            $this->table(
                ['Status', 'Records'],
                DB::table('payments')
                    ->select('status')
                    ->selectRaw('COUNT(*) as total')
                    ->groupBy('status')
                    ->orderBy('status')
                    ->get()
                    ->map(fn ($row) => [
                        $row->status ?? '(NULL)',
                        $row->total,
                    ])
                    ->all()
            );

            $this->newLine();

            if ($errors > 0) {
                $this->error(
                    "CHECK FAILED: {$errors} issue(s), {$warnings} warning(s)."
                );

                return self::FAILURE;
            }

            $this->info(
                "DATABASE CHECK PASSED — {$warnings} warning(s)."
            );

            $this->line(
                'The checked tables and relationships support starting the admin implementation.'
            );

            return self::SUCCESS;
        } catch (\Throwable $exception) {
            $this->error('Check failed: '.$exception->getMessage());

            return self::FAILURE;
        }
    }
}