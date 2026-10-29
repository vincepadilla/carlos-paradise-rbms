<?php

namespace App\Console\Commands;

use App\Services\ReservationWorkflow;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class ConfigureBookingPayment extends Command
{
    protected $signature =
        'reservations:payment-method {method : GCash or MariBank}';

    protected $description =
        'Configure the verified receiving account shown to guests';

    public function handle(ReservationWorkflow $flow): int
    {
        $data = [
            'method' => $this->argument('method'),

            'account_name' => $this->ask(
                'Verified account holder name'
            ),

            'account_number' => $this->ask(
                'Verified receiving account number'
            ),

            'instructions' => $this->ask(
                'Payment instructions',
                'Transfer the exact deposit, then upload your receipt.'
            ),
        ];

        $validator = Validator::make($data, [
            'method' => 'required|in:GCash,MariBank',
            'account_name' => 'required|string|max:255',
            'account_number' => 'required|string|max:255',
            'instructions' => 'nullable|string|max:2000',
        ]);

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $flow->locked(function () use ($data, $flow) {
            // Only one receiving account per provider is active.
            DB::table('payment_methods')
                ->where('name', $data['method'])
                ->update([
                    'is_active' => false,
                    'updated_at' => $flow->stamp(),
                ]);

            $existing = DB::table('payment_methods')
                ->where('name', $data['method'])
                ->where(
                    'account_number',
                    $data['account_number']
                )
                ->first();

            $values = [
                'account_name' => $data['account_name'],
                'instructions' => $data['instructions'],
                'is_active' => true,
                'updated_at' => $flow->stamp(),
            ];

            if ($existing) {
                DB::table('payment_methods')
                    ->where('id', $existing->id)
                    ->update($values);
            } else {
                DB::table('payment_methods')->insert([
                    ...$values,
                    'name' => $data['method'],
                    'account_number' =>
                        $data['account_number'],
                    'created_at' => $flow->stamp(),
                ]);
            }
        });

        $this->info(
            'Verified receiving account configured successfully.'
        );

        return self::SUCCESS;
    }
}