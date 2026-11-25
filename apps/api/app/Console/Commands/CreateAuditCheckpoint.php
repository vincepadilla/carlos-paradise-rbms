<?php

namespace App\Console\Commands;

use App\Services\AuditChain;
use Illuminate\Console\Command;

class CreateAuditCheckpoint extends Command
{
    protected $signature = 'audit:checkpoint {path : New checkpoint JSON file; existing files are never overwritten}';

    protected $description = 'Export a verified audit head for independent, protected storage';

    public function handle(AuditChain $chain): int
    {
        $result = $chain->verify();
        if ($result['status'] !== 'verified') {
            $this->error('Cannot checkpoint a broken chain. Run audit:verify for details.');

            return self::FAILURE;
        }
        $contents = json_encode(['format' => 'carlos-paradise-audit-checkpoint-v1',
            'sequence' => $result['head_sequence'], 'event_hash' => $result['head_hash'],
            'created_at' => $result['checked_at']], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT).PHP_EOL;
        $stream = @fopen($this->argument('path'), 'x');
        if (! $stream) {
            $this->error('Unable to create checkpoint. Choose a new file in an existing directory.');

            return self::FAILURE;
        }
        try {
            if (fwrite($stream, $contents) !== strlen($contents) || ! fflush($stream)) {
                $this->error('Checkpoint could not be fully written. Discard the incomplete file.');

                return self::FAILURE;
            }
        } finally {
            fclose($stream);
        }
        $this->info('Checkpoint created. Protect it independently of the application and database.');

        return self::SUCCESS;
    }
}
