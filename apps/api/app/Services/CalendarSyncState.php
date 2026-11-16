<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class CalendarSyncState
{
    public const RESERVATION_PUBLISH_STATUSES = ['confirmed', 'reserved', 'completed'];
    public const RESERVATION_REMOVE_STATUSES = ['cancelled', 'expired'];
    public const OCULAR_PUBLISH_STATUSES = ['approved'];
    public const OCULAR_REMOVE_STATUSES = ['cancelled'];

    public function integration(): array
    {
        $settings = config('services.google_calendar');

        return [
            'configured' => ! empty($settings['client_id'])
                && ! empty($settings['client_secret'])
                && ! empty($settings['redirect_uri'])
                && ! empty($settings['calendar_id']),
            'connected' => DB::table('google_calendar_connections')
                ->where('connection_key', 'carlos_paradise')
                ->exists(),
            'direction' => 'one_way',
            'schedule' => 'every_minute',
        ];
    }

    public function record(object $record, bool $publish): array
    {
        if (! $publish) {
            return ['state' => 'internal', 'synced_at' => null];
        }

        $syncedAt = $record->google_synced_at ?? null;
        $updatedAt = $record->updated_at ?? null;
        $mapped = ! empty($record->google_event_id);
        $hasCurrentHash = ! empty($record->google_sync_hash)
            && $record->google_sync_hash !== 'removed';
        $current = $syncedAt && $updatedAt
            ? CarbonImmutable::parse($syncedAt)->greaterThanOrEqualTo(CarbonImmutable::parse($updatedAt))
            : false;

        return [
            'state' => $mapped && $hasCurrentHash && $current ? 'synced' : 'pending',
            'synced_at' => $syncedAt
                ? CarbonImmutable::parse($syncedAt)->setTimezone('Asia/Manila')->toIso8601String()
                : null,
        ];
    }
}
