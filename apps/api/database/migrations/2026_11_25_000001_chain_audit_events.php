<?php

use App\Services\AuditChain;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_events', function (Blueprint $table) {
            $table->unsignedBigInteger('sequence')->nullable()->unique();
            $table->string('previous_hash', 64)->nullable();
            $table->string('event_hash', 64)->nullable();
            $table->text('context')->nullable();
            $table->string('source_table', 60)->nullable();
            $table->unsignedBigInteger('source_id')->nullable();
            $table->unique(['source_table', 'source_id']);
        });
        Schema::create('audit_chain_heads', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->unsignedBigInteger('sequence');
            $table->string('event_hash', 64);
        });
        DB::transaction(function () {
            DB::table('audit_chain_heads')->insert(['id' => 1, 'sequence' => 0, 'event_hash' => AuditChain::GENESIS]);
            $sequence = 0;
            $previous = AuditChain::GENESIS;
            // Seal retained events without claiming authenticity before this migration.
            foreach (DB::table('audit_events')->orderBy('id')->lazyById(500) as $row) {
                $row->sequence = ++$sequence;
                $row->previous_hash = $previous;
                $row->context = AuditChain::canonical(['legacy_baseline' => true]);
                $previous = AuditChain::digest($row);
                DB::table('audit_events')->where('id', $row->id)->update([
                    'sequence' => $sequence, 'previous_hash' => $row->previous_hash,
                    'context' => $row->context, 'event_hash' => $previous,
                ]);
            }
            DB::table('audit_chain_heads')->where('id', 1)->update(['sequence' => $sequence, 'event_hash' => $previous]);
            foreach (AuditChain::SOURCES as $table) {
                foreach (DB::table($table)->orderBy('id')->lazyById(500) as $row) {
                    app(AuditChain::class)->recordSource($table, $row->id, true);
                }
            }
        });
        $driver = DB::getDriverName();
        if ($driver === 'sqlite') {
            foreach (['UPDATE', 'DELETE'] as $operation) {
                DB::unprepared('CREATE TRIGGER audit_events_no_'.strtolower($operation)." BEFORE {$operation} ON audit_events BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END");
            }
        } elseif ($driver === 'pgsql') {
            DB::unprepared("CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END; $$");
            DB::unprepared('CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation()');
        } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
            foreach (['UPDATE', 'DELETE'] as $operation) {
                DB::unprepared('CREATE TRIGGER audit_events_no_'.strtolower($operation)." BEFORE {$operation} ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only'");
            }
        } else {
            throw new RuntimeException('Audit append-only enforcement is not configured for '.$driver);
        }
    }

    public function down(): void
    {
        throw new RuntimeException('Cryptographic audit history must be retained.');
    }
};
