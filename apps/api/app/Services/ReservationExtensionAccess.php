<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ReservationExtensionAccess
{
    public function __construct(private ReservationWorkflow $flow, private ReservationManagement $management) {}

    public function grant(int $id, int $actor, int $revision, string $date): void
    {
        $this->flow->locked(function () use ($id, $actor, $revision, $date) {
            $record = $this->flow->reservation($id, true);
            $this->management->checkRevision($record, $revision);
            abort_unless($this->management->capabilities($record)['can_grant_extension'], 422, 'Only an active unpaid deposit opportunity without a pending request can receive extension access.');
            $deadline = CarbonImmutable::parse($date, 'Asia/Manila')->endOfDay();
            if ($deadline->toDateString() <= $this->flow->now()->toDateString() || $deadline->lte(CarbonImmutable::parse($record->deadline)) || $deadline->gte(CarbonImmutable::parse($record->starts_at))) {
                throw ValidationException::withMessages(['agreed_deadline' => 'The agreed date must extend the actual deadline and remain before check-in.']);
            }
            $before = (array) DB::table('reservation_extension_access')->where('reservation_id', $id)->first();
            $values = ['enabled' => true, 'agreed_deadline' => $deadline->toIso8601String(), 'granted_by' => $actor, 'granted_at' => $this->flow->now()->toIso8601String(), 'revoked_at' => null, 'consumed_at' => null, 'updated_at' => $this->flow->stamp()];
            DB::table('reservation_extension_access')->updateOrInsert(['reservation_id' => $id], [...$values, 'created_at' => $before['created_at'] ?? $this->flow->stamp()]);
            DB::table('reservations')->where('id', $id)->increment('admin_revision');
            $this->management->audit($record, $actor, 'extension_access_granted', $before, $values);
        });
    }

    public function revoke(int $id, int $actor, int $revision): void
    {
        $this->flow->locked(function () use ($id, $actor, $revision) {
            $record = $this->flow->reservation($id, true);
            $this->management->checkRevision($record, $revision);
            abort_unless($this->management->capabilities($record)['can_grant_extension'], 422, 'Extension access can only be revoked during an active unpaid opportunity.');
            $access = DB::table('reservation_extension_access')->where('reservation_id', $id)->lockForUpdate()->first();
            abort_unless($access && $access->enabled && ! $access->consumed_at, 422, 'This access was already revoked or consumed.');
            $values = ['enabled' => false, 'revoked_at' => $this->flow->now()->toIso8601String(), 'updated_at' => $this->flow->stamp()];
            DB::table('reservation_extension_access')->where('id', $access->id)->update($values);
            DB::table('reservations')->where('id', $id)->increment('admin_revision');
            $this->management->audit($record, $actor, 'extension_access_revoked', (array) $access, $values);
        });
    }

    public function consume(object $record, int $actor, CarbonImmutable $date): void
    {
        $access = DB::table('reservation_extension_access')->where('reservation_id', $record->id)->lockForUpdate()->first();
        abort_unless($access && $access->enabled && ! $access->consumed_at && ! $access->revoked_at, 422, 'Contact the Admin for extension authorization before requesting another payment date.');
        if ($date->endOfDay()->gt(CarbonImmutable::parse($access->agreed_deadline)->endOfDay())) {
            throw ValidationException::withMessages(['requested_date' => 'The requested date exceeds the extension authorized by the Admin.']);
        }
        DB::table('reservation_extension_access')->where('id', $access->id)->update(['enabled' => false, 'consumed_at' => $this->flow->now()->toIso8601String(), 'updated_at' => $this->flow->stamp()]);
        $this->management->audit($record, $actor, 'extension_access_consumed', (array) $access, ['enabled' => false, 'requested_date' => $date->toDateString()]);
    }
}
