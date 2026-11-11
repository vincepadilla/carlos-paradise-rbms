<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_versions', function (Blueprint $table) {
            $table->id();
            $table->string('document_key', 60);
            $table->unsignedInteger('version');
            $table->string('original_name');
            $table->string('storage_path');
            $table->string('sha256', 64);
            $table->unsignedBigInteger('size');
            $table->text('notes')->nullable();
            $table->foreignId('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at');
            $table->unique(['document_key', 'version']);
        });
        Schema::create('active_documents', function (Blueprint $table) {
            $table->string('document_key', 60)->primary();
            $table->foreignId('version_id')->unique()->constrained('document_versions')->restrictOnDelete();
            $table->timestampTz('updated_at');
        });
        Schema::create('audit_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('user_name');
            $table->string('role', 30);
            $table->string('action', 80);
            $table->string('module', 60);
            $table->text('details');
            $table->timestampTz('occurred_at');
            $table->index(['occurred_at', 'id']);
            $table->index(['module', 'action']);
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Owner document versions and audit history must be retained.');
    }
};
