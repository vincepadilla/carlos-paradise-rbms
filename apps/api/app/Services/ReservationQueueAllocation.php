<?php

declare(strict_types=1);

namespace App\Services;

use App\Models\User;
use App\Services\Algorithms\AugmentedIntervalTree;
use App\Services\Algorithms\EligibilityConstrainedFifo;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\Algorithms\ReservationIntervalTrees;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

final class ReservationQueueAllocation
{
    public function __construct(
        private readonly ReservationWorkflow $flow,
        private readonly EligibilityConstrainedFifo $fifo,
        private readonly ReservationIntervalNormalizer $normalizer,
    ) {}

    /** Call inside ReservationWorkflow::locked(), together with the staff operation. */
    public function release(int $reservationId, User $actor): array
    {
        $this->flow->requireStaff($actor);
        $record = $this->flow->reservation($reservationId, true);
        $opportunity = DB::table('reservation_opportunities')->where('reservation_id', $reservationId)
            ->orderByDesc('id')->lockForUpdate()->first();
        abort_unless($opportunity, 422, 'This reservation has no deposit opportunity to release.');

        $existing = DB::table('reservation_queue_releases')->where('opportunity_id', $opportunity->id)->value('id');
        if ($existing !== null) {
            return $this->recommendation((int) $existing);
        }
        abort_unless(in_array($record->status, ['held', 'awaiting_deposit', 'expired', 'cancelled'], true)
            && in_array($opportunity->status, ['active', 'expired'], true), 422, 'Only an unpaid, protected opportunity can be released.');
        abort_if(DB::table('payments')->where('reservation_id', $reservationId)->whereIn('status', ['submitted', 'approved'])->exists(),
            422, 'Resolve the payment before releasing this opportunity.');

        $now = $this->flow->now()->startOfSecond();
        $releaseId = DB::table('reservation_queue_releases')->insertGetId([
            'opportunity_id' => $opportunity->id,
            'villa_id' => $record->villa_id,
            'starts_at' => $record->starts_at,
            'ends_at' => $record->ends_at,
            'decided_at' => $now->toIso8601String(),
            // New requests can share this second; only rows present at release can compete.
            'queue_max_id' => DB::table('reservations')->where('villa_id', $record->villa_id)->max('id'),
            'released_by' => $actor->id,
        ]);
        DB::table('reservation_opportunities')->where('id', $opportunity->id)->update([
            'status' => 'revoked', 'closed_at' => $now->toIso8601String(), 'updated_at' => $this->flow->stamp(),
        ]);
        if (in_array($record->status, ['held', 'awaiting_deposit'], true)) {
            $this->flow->state($record, 'cancelled', $actor->id, 'Staff released the unpaid deposit opportunity.');
        }

        return $this->recommendation($releaseId);
    }

    public function recommendation(int $releaseId): array
    {
        $release = $this->findRelease($releaseId);
        $selection = ['selected_reservation_id' => null, 'eligible_candidates' => 0];
        if ($release->granted_reservation_id === null) {
            $now = $this->flow->now()->startOfSecond();
            $selection = $this->select($release, $this->waiting($release->villa_id), $this->protected($release->villa_id, $now), $now);
        }
        $found = $selection['selected_reservation_id'] !== null;

        return [
            'release_id' => (int) $release->id,
            'selection_policy' => 'FIFO',
            ...$selection,
            'candidate_found' => $found,
            'approval_required' => $found,
            'granted_reservation_id' => $release->granted_reservation_id === null ? null : (int) $release->granted_reservation_id,
            'reason' => $release->granted_reservation_id !== null ? 'already_granted' : ($found ? 'earliest_eligible' : 'no_eligible_guest'),
        ];
    }

    /** Call inside the villa transaction. Selection is recomputed before recording a grant. */
    public function grant(int $releaseId, int $reservationId, User $actor): object
    {
        $this->flow->requireStaff($actor);
        $release = $this->findRelease($releaseId);
        if ($release->granted_reservation_id !== null) {
            abort_unless((int) $release->granted_reservation_id === $reservationId, 409, 'This release has already been allocated.');

            return $this->flow->reservation($reservationId);
        }

        $now = $this->flow->now()->startOfSecond();
        $selection = $this->select($release, $this->waiting($release->villa_id), $this->protected($release->villa_id, $now), $now);
        abort_unless($selection['selected_reservation_id'] === $reservationId, 409, 'This guest is no longer the earliest eligible candidate for this release.');
        $record = $this->flow->reservation($reservationId, true);
        abort_unless($record->price_agreed && (float) $record->required_deposit > 0
            && (float) $record->quoted_total >= (float) $record->required_deposit, 422, 'Agree the price and deposit before granting the opportunity.');
        $deadline = $this->flow->createOpportunity($record, $actor->id);
        $this->flow->state($record, 'awaiting_deposit', $actor->id, 'Staff granted the deposit opportunity after a verified release.', [
            'deadline' => $deadline->toIso8601String(), 'processed_by' => $actor->id, 'processed_at' => $now->toIso8601String(),
        ]);
        DB::table('reservation_queue_releases')->where('id', $releaseId)->update([
            'granted_reservation_id' => $reservationId, 'approved_by' => $actor->id, 'approved_at' => $now->toIso8601String(),
        ]);

        return $this->flow->reservation($reservationId);
    }

    /** Reserve the recommended guest's place while staff decide, sharing one calendar snapshot per batch. */
    public function pendingCandidateIntervals(CarbonImmutable $rangeStart, CarbonImmutable $rangeEnd, int $villaId = 1): AugmentedIntervalTree
    {
        $now = $this->flow->now()->startOfSecond();
        $open = DB::table('reservation_queue_releases')->where('villa_id', $villaId)
            ->whereNull('granted_reservation_id')->where('ends_at', '>', $now->toIso8601String())->get();
        if ($open->isEmpty()) {
            return new AugmentedIntervalTree;
        }

        $waiting = $this->waiting($villaId);
        $protected = $this->protected($villaId, $now);
        $intervals = [];
        foreach ($open as $release) {
            $selectedId = $this->select($release, $waiting, $protected, $now)['selected_reservation_id'];
            if ($selectedId === null || isset($intervals[$selectedId])) {
                continue;
            }
            $candidate = $waiting->get($selectedId);
            $interval = $this->normalizer->interval($candidate->starts_at, $candidate->ends_at,
                ReservationIntervalMode::QueueAllocation, $candidate->type, true);
            if ($interval['start'] < $rangeEnd->getTimestamp() && $interval['end'] > $rangeStart->getTimestamp()
                && $this->flow->depositDeadline($candidate)->gt($now)) {
                $intervals[$selectedId] = $interval;
            }
        }

        return new AugmentedIntervalTree(array_values($intervals));
    }

    private function findRelease(int $releaseId): object
    {
        $release = DB::table('reservation_queue_releases')->where('id', $releaseId)->first();
        abort_unless($release, 404, 'Verified release not found.');

        return $release;
    }

    private function waiting(int $villaId): Collection
    {
        return DB::table('reservations')->where('villa_id', $villaId)->whereIn('status', ['queued', 'pending'])
            ->get(['id', 'requested_at', 'starts_at', 'ends_at', 'type', 'status', 'deposit_window_hours'])->keyBy('id');
    }

    private function protected(int $villaId, CarbonImmutable $now): ReservationIntervalTrees
    {
        return (new ReservationIntervalTreeBuilder(DB::connection()))->build($villaId, $now, ReservationIntervalMode::QueueAllocation);
    }

    private function select(object $release, Collection $waiting, ReservationIntervalTrees $protected, CarbonImmutable $now): array
    {
        $decision = $this->normalizer->epoch($release->decided_at);
        $candidates = $waiting->filter(function (object $candidate) use ($release, $decision, $now): bool {
            if ($candidate->id > $release->queue_max_id) {
                return false;
            }
            // Exactly at release, check-in equality is eligible for a recommendation.
            // On a later review, skip a waiter who can no longer receive a payable window.
            if ($now->getTimestamp() <= $decision) {
                return true;
            }
            try {
                return $this->normalizer->epoch($candidate->starts_at) - 60 > $now->getTimestamp()
                    && $candidate->deposit_window_hours > 0;
            } catch (InvalidArgumentException) {
                return false;
            }
        });

        return $this->fifo->select($candidates, $release->starts_at, $release->ends_at, $release->decided_at, $protected);
    }
}
