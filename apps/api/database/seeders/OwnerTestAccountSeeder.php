<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class OwnerTestAccountSeeder extends Seeder
{
    public function run(): void
    {
        DB::table('users')->updateOrInsert(
            ['email' => 'carlos.quitua.owner@example.com'],
            [
                'name' => 'Carlos Quitua',
                'password' => Hash::make('Owner123!'),
                'role_id' => 3,
                'email_verified_at' => now(),
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );
    }
}