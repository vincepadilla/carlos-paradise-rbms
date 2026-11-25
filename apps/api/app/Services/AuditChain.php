<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class AuditChain
{
    public const GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

    public const SOURCES = ['reservation_status_history', 'payment_reviews'];

    public function append(?User $user, string $action, string $module, string $details, array $context = [], ?string $at = null, ?string $source = null, ?int $sourceId = null): int
    {
        return DB::transaction(function () use ($user, $action, $module, $details, $context, $at, $source, $sourceId) {
            if ($user !== null && app()->bound('request') && request()->user()?->id === $user->id && request()->attributes->has('audit_context')) {
                $context['request'] = request()->attributes->get('audit_context');
            }
            $head = DB::table('audit_chain_heads')->where('id', 1)->lockForUpdate()->first();
            if (! $head) {
                throw new RuntimeException('Audit chain is not initialized.');
            }
            $sequence = (int) $head->sequence + 1;
            // The stable singleton also serializes the first append to an empty chain.
            $last = DB::table('audit_events')->orderByDesc('sequence')->first();
            if (($last ? (int) $last->sequence : 0) !== (int) $head->sequence || ($last->event_hash ?? self::GENESIS) !== $head->event_hash) {
                throw new RuntimeException('Audit chain head mismatch; writes have been stopped.');
            }
            if ($last && ! hash_equals($last->event_hash, self::digest($last))) {
                throw new RuntimeException('Latest audit event was modified; writes have been stopped.');
            }
            $entry = (object) [
                // Allocate under the chain lock so the primary key is also covered by the hash.
                'id' => $last ? (int) $last->id + 1 : 1,
                'user_id' => $user?->id, 'user_name' => $user?->name ?? 'System',
                'role' => $user?->role?->name ?? 'system', 'action' => $action, 'module' => $module, 'details' => $details,
                'occurred_at' => CarbonImmutable::parse($at ?? now('UTC'))->utc()->toIso8601String(),
                'sequence' => $sequence, 'previous_hash' => $head->event_hash,
                'event_hash' => self::GENESIS, 'context' => self::canonical($context),
                'source_table' => $source, 'source_id' => $sourceId,
            ];
            $hash = self::digest($entry);
            $entry->event_hash = $hash;
            $id = DB::table('audit_events')->insertGetId((array) $entry);
            DB::table('audit_chain_heads')->where('id', 1)->update(['sequence' => $sequence, 'event_hash' => $hash]);
            if (app()->bound('request') && request()->user()?->id === $user?->id && $user !== null) {
                request()->attributes->set('audit_recorded', true);
            }

            return $id;
        });
    }

    public function recordSource(string $table, int $id, bool $legacyBaseline = false): void
    {
        if (! in_array($table, self::SOURCES, true)) {
            throw new RuntimeException('Unsupported audit source.');
        }
        $row = DB::table($table)->where('id', $id)->first();
        if (! $row) {
            throw new RuntimeException('Missing audit source.');
        }
        $reservation = $table === 'reservation_status_history';
        $actor = $reservation ? $row->changed_by : $row->reviewed_by;
        $this->append($actor ? User::find($actor) : null,
            $reservation ? ($row->event ?? 'status_changed') : 'payment_'.$row->decision,
            $reservation ? 'Reservations' : 'Payments',
            ($reservation ? $row->reason : $row->notes) ?? '',
            ['source_snapshot' => (array) $row, 'legacy_baseline' => $legacyBaseline],
            $reservation ? $row->changed_at : $row->reviewed_at, $table, $id);
    }

    public static function canonical(array $value): string
    {
        $sort = function (array $items) use (&$sort): array {
            if (! array_is_list($items)) {
                ksort($items, SORT_STRING);
            }
            foreach ($items as &$item) {
                if (is_array($item)) {
                    $item = $sort($item);
                }
            }

            return $items;
        };

        return json_encode($sort($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }

    public static function digest(object $row): string
    {
        return hash('sha256', self::canonical([
            'version' => 1, 'id' => (int) $row->id, 'sequence' => (int) $row->sequence,
            'previous_hash' => $row->previous_hash, 'user_id' => $row->user_id === null ? null : (int) $row->user_id,
            'user_name' => $row->user_name, 'role' => $row->role, 'action' => $row->action,
            'module' => $row->module, 'details' => $row->details,
            'occurred_at' => CarbonImmutable::parse($row->occurred_at)->utc()->format('Y-m-d\TH:i:s.u\Z'),
            'context' => $row->context, 'source_table' => $row->source_table,
            'source_id' => $row->source_id === null ? null : (int) $row->source_id,
        ]));
    }

    public function verify(?array $checkpoint = null): array
    {
        return DB::transaction(function () use ($checkpoint) {
            // Hold the head while reading, so concurrent appends cannot produce a false alarm.
            $head = DB::table('audit_chain_heads')->where('id', 1)->sharedLock()->first();
            $sequence = 0;
            $hash = self::GENESIS;
            $failure = null;
            $fail = function (string $reason, ?int $id = null) use (&$failure) {
                $failure = ['reason' => $reason, 'entry_id' => $id];
            };
            foreach (DB::table('audit_events')->orderBy('sequence')->orderBy('id')->lazy(500) as $row) {
                if ((int) $row->sequence !== $sequence + 1 || $row->previous_hash !== $hash) {
                    $fail('Missing, reordered, or unlinked event.', $row->id);
                    break;
                }
                try {
                    $valid = hash_equals($row->event_hash ?? '', self::digest($row));
                } catch (\Throwable) {
                    $valid = false;
                }
                if (! $valid) {
                    $fail('Event contents do not match their SHA-256 hash.', $row->id);
                    break;
                }
                if ($row->source_table !== null) {
                    if (! in_array($row->source_table, self::SOURCES, true)) {
                        $fail('Unknown source table.', $row->id);
                        break;
                    }
                    $source = DB::table($row->source_table)->where('id', $row->source_id)->first();
                    $snapshot = json_decode($row->context, true)['source_snapshot'] ?? null;
                    if (! $source || ! is_array($snapshot) || self::canonical((array) $source) !== self::canonical($snapshot)) {
                        $fail('Original history was modified or deleted.', $row->id);
                        break;
                    }
                }
                $sequence++;
                $hash = $row->event_hash;
            }
            if (! $failure && (! $head || (int) $head->sequence !== $sequence || $head->event_hash !== $hash)) {
                $fail('Chain head mismatch or deleted tail.');
            }
            foreach (self::SOURCES as $table) {
                if (! $failure && DB::table($table.' as history')->whereNotExists(fn ($q) => $q->selectRaw('1')->from('audit_events')->where('source_table', $table)->whereColumn('source_id', 'history.id'))->exists()) {
                    $fail('Unsealed history found in '.$table.'.');
                }
            }
            if (! $failure && $checkpoint !== null) {
                $expectedSequence = $checkpoint['sequence'] ?? null;
                $expectedHash = $checkpoint['event_hash'] ?? null;
                if (! is_int($expectedSequence) || $expectedSequence < 0 || ! is_string($expectedHash) || ! preg_match('/^[a-f0-9]{64}$/D', $expectedHash)) {
                    $fail('Invalid external checkpoint.');
                } else {
                    $savedHash = $expectedSequence === 0 ? self::GENESIS : DB::table('audit_events')->where('sequence', $expectedSequence)->value('event_hash');
                    if ($expectedSequence > $sequence || $savedHash !== $expectedHash) {
                        $fail('External checkpoint mismatch: history was rewritten or truncated.');
                    }
                }
            }

            return ['status' => $failure ? 'broken' : 'verified', 'checked_at' => now('UTC')->toIso8601String(),
                'verified_entries' => $sequence, 'head_sequence' => (int) ($head->sequence ?? 0),
                'head_hash' => $head->event_hash ?? self::GENESIS, 'failure' => $failure,
                'external_checkpoint_checked' => $checkpoint !== null];
        });
    }
}
