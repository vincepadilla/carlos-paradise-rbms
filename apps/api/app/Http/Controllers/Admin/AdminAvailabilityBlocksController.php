<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminAvailabilityBlocksController extends Controller
{
    public function __construct(private ReservationWorkflow $flow) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);

        $blocks = DB::table('availability_blocks')
            ->where('villa_id', 1)
            ->whereNull('released_at')
            ->select(['id', 'starts_on', 'ends_on', 'reason'])
            ->orderBy('starts_on')
            ->orderBy('id')
            ->paginate(25);

        return response()->json($blocks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date' => ['required', 'date_format:Y-m-d', 'after_or_equal:'.$this->flow->now()->toDateString()],
            'reason' => ['required', 'string', 'max:4200'],
        ]);

        return $this->flow->locked(function () use ($request, $data) {
            $start = CarbonImmutable::parse($data['date'], 'Asia/Manila')->startOfDay();
            $end = $start->addDay();
            // Use the same commitment/hold rules and villa lock as booking mutations.
            $this->flow->available((object) [
                'id' => 0, 'villa_id' => 1,
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(),
            ]);
            $id = DB::table('availability_blocks')->insertGetId([
                'villa_id' => 1, 'starts_on' => $start->toDateString(), 'ends_on' => $end->toDateString(),
                'reason' => trim($data['reason']), 'created_by' => $request->user()->id,
                'created_at' => $this->flow->stamp(), 'updated_at' => $this->flow->stamp(),
            ]);

            return response()->json(['block' => $this->findBlock($id)], 201);
        });
    }

    public function update(Request $request, int $block): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:4200']]);

        return $this->flow->locked(function () use ($block, $data) {
            $this->findBlock($block);
            DB::table('availability_blocks')->where('id', $block)->update([
                'reason' => trim($data['reason']), 'updated_at' => $this->flow->stamp(),
            ]);

            return response()->json(['block' => $this->findBlock($block)]);
        });
    }

    public function release(int $block): JsonResponse
    {
        return $this->flow->locked(function () use ($block) {
            $this->findBlock($block);
            DB::table('availability_blocks')->where('id', $block)->update([
                'released_at' => $this->flow->now()->toIso8601String(), 'updated_at' => $this->flow->stamp(),
            ]);

            return response()->json(['message' => 'The date block was released.']);
        });
    }

    private function findBlock(int $id): object
    {
        $block = DB::table('availability_blocks')->where('villa_id', 1)->where('id', $id)
            ->whereNull('released_at')->first(['id', 'starts_on', 'ends_on', 'reason']);
        abort_unless($block, 404, 'This date block is no longer available.');

        return $block;
    }
}
