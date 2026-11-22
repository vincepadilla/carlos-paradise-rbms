<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Database\PostgresConnection;
use Illuminate\Database\Schema\Blueprint;
use RuntimeException;

/** Disposable fixture schema with the production availability column types and indexes. */
final class PostgresShadowFixture
{
    public readonly PostgresConnection $database;

    public readonly PostgresConnection $writer;

    private readonly string $schema;

    public function __construct(private readonly DisposablePostgresCluster $cluster)
    {
        $this->database = $cluster->connection();
        $this->writer = $cluster->connection();
        $this->schema = 'fixture_'.bin2hex(random_bytes(16));
        $this->database->statement('CREATE SCHEMA "'.$this->schema.'"');
        foreach ([$this->database, $this->writer] as $connection) {
            $connection->statement('SET search_path TO "'.$this->schema.'", public');
            $connection->statement("SET TIME ZONE 'Asia/Manila'");
            $connection->statement("SET DateStyle TO 'ISO, YMD'");
        }
        $this->createSchema();
    }

    public function close(): void
    {
        $this->database->disconnect();
        $this->writer->disconnect();
        if (! preg_match('/^fixture_[a-f0-9]{32}$/D', $this->schema)) {
            throw new RuntimeException('Invalid disposable schema cleanup target.');
        }
        // connection() re-verifies cluster, database and ownership marker before cleanup.
        $cleanup = $this->cluster->connection();
        $cleanup->statement('DROP SCHEMA "'.$this->schema.'" CASCADE');
        $cleanup->disconnect();
    }

    private function createSchema(): void
    {
        $schema = $this->database->getSchemaBuilder();
        $schema->create('reservations', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status', 30);
            $table->string('type', 20);
            $table->timestampTz('starts_at', 0);
            $table->timestampTz('ends_at', 0);
            $table->timestampTz('deadline', 0)->nullable();
            $table->index(['villa_id', 'status']);
            $table->index(['villa_id', 'starts_at', 'ends_at']);
        });
        $schema->create('reservation_opportunities', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('reservation_id');
            $table->string('status', 30);
            $table->timestampTz('deposit_deadline', 0);
            $table->timestampTz('closed_at', 0)->nullable();
            $table->index(['reservation_id', 'status']);
        });
        $this->database->statement("CREATE UNIQUE INDEX one_active_fixture_opportunity ON reservation_opportunities (reservation_id) WHERE status = 'active'");
        $schema->create('availability_blocks', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->timestampTz('released_at', 0)->nullable();
            $table->index(['villa_id', 'starts_on', 'ends_on']);
        });
        $schema->create('ocular_visits', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status', 30);
            $table->date('visit_date');
            $table->time('start_time');
            $table->time('end_time');
        });
    }
}
