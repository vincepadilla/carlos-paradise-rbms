<?php

namespace App\Console\Commands;

use App\Services\AuditChain;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class VerifyAuditChain extends Command
{
    protected $signature = 'audit:verify {--checkpoint= : Path to a previously protected checkpoint JSON file}';

    protected $description = 'Verify the SHA-256 audit chain and original reservation/payment history';

    public function handle(AuditChain $chain): int
    {
        try {
            $path = $this->option('checkpoint') ?: config('audit.checkpoint_path');
            $checkpoint = $path ? json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR) : null;
            if ($path && ! is_array($checkpoint)) {
                throw new \RuntimeException('Checkpoint must be a JSON object.');
            }
            $result = $chain->verify($checkpoint);
            if ($result['status'] !== 'verified') {
                Log::critical('Audit chain integrity failure', $result);
                $this->error(json_encode($result, JSON_THROW_ON_ERROR));

                return self::FAILURE;
            }
            $this->info(json_encode($result, JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        } catch (\Throwable $error) {
            Log::critical('Audit chain verification could not complete', ['error' => $error->getMessage()]);
            $this->error('Audit verification failed: '.$error->getMessage());

            return self::FAILURE;
        }
    }
}
