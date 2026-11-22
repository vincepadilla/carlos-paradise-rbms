<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\SQLiteConnection;
use PDO;
use RuntimeException;

/** Literal in-memory DSN: never boots Laravel, loads .env, or runs migrations. */
final class ReservationIntervalFixtures
{
    public const NOW = '2026-11-21T10:00:00+08:00';

    public const START = '2026-11-30T14:00:00+08:00';

    public const END = '2026-12-01T11:00:00+08:00';

    public static function database(): SQLiteConnection
    {
        if (! extension_loaded('pdo_sqlite')) {
            throw new RuntimeException('The isolated fixtures require pdo_sqlite.');
        }
        $database = new SQLiteConnection(new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]), ':memory:');
        $schema = $database->getSchemaBuilder();
        $schema->create('reservations', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status');
            $table->string('type');
            $table->string('starts_at');
            $table->string('ends_at');
            $table->string('deadline')->nullable();
        });
        $schema->create('reservation_opportunities', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('reservation_id');
            $table->string('status');
            $table->string('deposit_deadline');
            $table->string('closed_at')->nullable();
        });
        $schema->create('availability_blocks', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('starts_on');
            $table->string('ends_on');
            $table->string('released_at')->nullable();
        });
        $schema->create('ocular_visits', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status');
            $table->string('visit_date');
            $table->string('start_time');
            $table->string('end_time');
        });

        return $database;
    }

    public static function load(Connection $database, array $fixture): void
    {
        foreach ($fixture as $table => $records) {
            if ($records !== []) {
                $database->table($table)->insert($records);
            }
        }
    }

    public static function reservation(array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'villa_id' => 1, 'status' => 'confirmed', 'type' => 'overnight',
            'starts_at' => self::START, 'ends_at' => self::END, 'deadline' => self::NOW,
        ], $overrides);
    }

    public static function opportunity(array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'reservation_id' => 1, 'status' => 'active',
            'deposit_deadline' => '2026-11-22T10:00:00+08:00', 'closed_at' => null,
        ], $overrides);
    }
}
