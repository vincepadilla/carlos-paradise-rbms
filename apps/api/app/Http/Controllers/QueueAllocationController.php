<?php

namespace App\Http\Controllers;

use App\Services\ReservationQueueAllocation;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class QueueAllocationController extends Controller
{
    public function __construct(
        private ReservationWorkflow $flow,
        private ReservationQueueAllocation $allocation,
    ) {}

    public function release(Request $request, int $reservation): JsonResponse
    {
        return $this->flow->locked(fn () => response()->json(
            $this->allocation->release($reservation, $request->user())
        ));
    }

    public function solve(Request $request): JsonResponse
    {
        $data = $request->validate([
            'operation' => ['required', 'in:queue_select'],
            'release_id' => ['required', 'integer', 'min:1'],
        ]);

        return $this->flow->locked(function () use ($data) {
            $start = hrtime(true);
            $result = $this->allocation->recommendation((int) $data['release_id']);
            $duration = (hrtime(true) - $start) / 1_000_000;
            $approvalRequired = $result['approval_required'];
            unset($result['approval_required']);

            return response()->json([
                'operation' => 'queue_select', 'status' => 'ok', 'result' => $result,
                'execution_time_ms' => $duration, 'approval_required' => $approvalRequired,
            ]);
        }, expireUnpaid: false);
    }

    public function extend(Request $request, int $reservation): JsonResponse
    {
        $data = $request->validate(['deadline' => ['required', 'date_format:Y-m-d\TH:i']]);
        $deadline = CarbonImmutable::createFromFormat('!Y-m-d\TH:i', $data['deadline'], 'Asia/Manila');

        return $this->flow->locked(function () use ($request, $reservation, $deadline) {
            $record = $this->flow->reservation($reservation, true);
            abort_if($record->extension_status === 'pending', 422, 'Review the pending extension request first.');
            $this->flow->extendUnreleased($record, $deadline, $request->user()->id);

            return response()->json(['reservation' => $this->flow->present($this->flow->reservation($reservation))]);
        });
    }
}
