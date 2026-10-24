<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $table) {
            $table->id();
            $table->string('name', 30)->unique();
            $table->timestamps();
        });

        $now = now();

        $guestId = DB::table('roles')->insertGetId([
            'name' => 'guest',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('roles')->insert([
            [
                'name' => 'admin',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'name' => 'owner',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        Schema::table('users', function (Blueprint $table) use ($guestId) {
            $table->foreignId('role_id')
                ->default($guestId)
                ->constrained('roles')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('role_id');
        });

        Schema::dropIfExists('roles');
    }
};