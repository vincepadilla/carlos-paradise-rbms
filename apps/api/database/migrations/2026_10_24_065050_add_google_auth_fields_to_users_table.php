<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('google_id')->nullable()->unique();
            $table->text('avatar')->nullable();
            $table->string('phone', 30)->nullable();
            $table->boolean('is_active')->default(true);

            // Google-only accounts do not need a local password.
            $table->string('password')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['google_id']);
            $table->dropColumn([
                'google_id',
                'avatar',
                'phone',
                'is_active',
            ]);
        });

        // Keep password nullable: Google-only accounts may exist.
    }
};