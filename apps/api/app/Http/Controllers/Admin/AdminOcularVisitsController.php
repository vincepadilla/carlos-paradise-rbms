<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AdminOcularVisitsController extends Controller
{
    private const STATUSES = ['pending_review', 'approved', 'cancelled'];
    private const SOURCES = ['Facebook Messenger', 'TikTok', 'Instagram', 'WhatsApp', 'Phone Call'];

    public function __construct(private ReservationWorkflow $flow) {}

    public function show(int $ocularVisit): JsonResponse
    {
        return response()->json(['ocular_visit' => $this->find($ocularVisit)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->scheduleRules(true));
        $this->validateSchedule($data);

        return $this->flow->locked(function () use ($request, $data) {
            $id = DB::table('ocular_visits')->insertGetId([
                'villa_id' => 1,
                ...$this->scheduleValues($data),
                'status' => $data['status'],
                'created_by' => $request->user()->id,
                'revision' => 1,
                'created_at' => $this->flow->stamp(),
                'updated_at' => $this->flow->stamp(),
            ]);

            return response()->json(['ocular_visit' => $this->find($id)], 201);
        });
    }

    public function update(Request $request, int $ocularVisit): JsonResponse
    {
        $data = $request->validate([
            ...$this->scheduleRules(false),
            'revision' => ['required', 'integer', 'min:1'],
        ]);
        $this->validateSchedule($data);

        return $this->flow->locked(function () use ($ocularVisit, $data) {
            $current = $this->find($ocularVisit);
            abort_if($current->status === 'cancelled', 422, 'Cancelled ocular visits cannot be rescheduled.');
            $changed = DB::table('ocular_visits')->where('id', $ocularVisit)
                ->where('revision', $data['revision'])->where('status', '!=', 'cancelled')
                ->update([...$this->scheduleValues($data), 'revision' => DB::raw('revision + 1'), 'updated_at' => $this->flow->stamp()]);
            $this->staleUnless($changed, $ocularVisit);

            return response()->json(['ocular_visit' => $this->find($ocularVisit)]);
        });
    }

    public function approve(Request $request, int $ocularVisit): JsonResponse
    {
        return $this->changeStatus($request, $ocularVisit, 'pending_review', 'approved');
    }

    public function cancel(Request $request, int $ocularVisit): JsonResponse
    {
        $data = $request->validate(['revision' => ['required', 'integer', 'min:1']]);

        return $this->flow->locked(function () use ($ocularVisit, $data) {
            $this->find($ocularVisit);
            $changed = DB::table('ocular_visits')->where('id', $ocularVisit)
                ->where('revision', $data['revision'])->where('status', '!=', 'cancelled')
                ->update(['status' => 'cancelled', 'revision' => DB::raw('revision + 1'), 'updated_at' => $this->flow->stamp()]);
            if (! $changed) {
                $current = $this->find($ocularVisit);
                abort_if($current->status === 'cancelled', 422, 'This ocular visit is already cancelled.');
                abort(409, 'This ocular visit changed while you were viewing it. Refresh the details and try again.');
            }

            return response()->json(['ocular_visit' => $this->find($ocularVisit)]);
        });
    }

    private function changeStatus(Request $request, int $id, string $from, string $to): JsonResponse
    {
        $data = $request->validate(['revision' => ['required', 'integer', 'min:1']]);

        return $this->flow->locked(function () use ($id, $data, $from, $to) {
            $this->find($id);
            $changed = DB::table('ocular_visits')->where('id', $id)
                ->where('revision', $data['revision'])->where('status', $from)
                ->update(['status' => $to, 'revision' => DB::raw('revision + 1'), 'updated_at' => $this->flow->stamp()]);
            $this->staleUnless($changed, $id, 'Only ocular visits awaiting approval can be approved.');

            return response()->json(['ocular_visit' => $this->find($id)]);
        });
    }

    private function scheduleRules(bool $creating): array
    {
        return [
            'guest_name' => ['required', 'string', 'max:255'],
            'contact_details' => ['required', 'string', 'max:255'],
            'visit_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:'.$this->flow->now()->toDateString()],
            'start_time' => ['required', 'date_format:H:i'],
            'end_time' => ['required', 'date_format:H:i', 'after:start_time'],
            ...($creating ? ['status' => ['required', Rule::in(self::STATUSES)]] : []),
            'inquiry_source' => ['nullable', Rule::in(self::SOURCES)],
            'notes' => ['nullable', 'string', 'max:4200'],
        ];
    }

    private function validateSchedule(array $data): void
    {
        $start = CarbonImmutable::createFromFormat('Y-m-d H:i', $data['visit_date'].' '.$data['start_time'], 'Asia/Manila');
        if ($start->lessThanOrEqualTo($this->flow->now())) {
            throw ValidationException::withMessages(['start_time' => 'The ocular visit must be scheduled in the future.']);
        }
    }

    private function scheduleValues(array $data): array
    {
        return [
            'guest_name' => trim($data['guest_name']),
            'contact_details' => trim($data['contact_details']),
            'visit_date' => $data['visit_date'],
            'start_time' => $data['start_time'],
            'end_time' => $data['end_time'],
            'inquiry_source' => $data['inquiry_source'] ?? null,
            'notes' => isset($data['notes']) ? trim($data['notes']) ?: null : null,
        ];
    }

    private function find(int $id): object
    {
        $visit = DB::table('ocular_visits as ocular')
            ->join('users as creator', 'creator.id', '=', 'ocular.created_by')
            ->where('ocular.villa_id', 1)->where('ocular.id', $id)
            ->first(self::columns());
        abort_unless($visit, 404, 'This ocular visit is no longer available.');

        return $visit;
    }

    private function staleUnless(int $changed, int $id, ?string $invalidStatus = null): void
    {
        if ($changed) return;
        $current = $this->find($id);
        if ($invalidStatus && $current->status !== 'pending_review') abort(422, $invalidStatus);
        abort(409, 'This ocular visit changed while you were viewing it. Refresh the details and try again.');
    }

    public static function columns(): array
    {
        return ['ocular.id', 'ocular.guest_name', 'ocular.contact_details', 'ocular.visit_date', 'ocular.start_time',
            'ocular.end_time', 'ocular.status', 'ocular.inquiry_source', 'ocular.notes', 'ocular.created_by',
            'creator.name as creator_name', 'ocular.revision', 'ocular.updated_at'];
    }
}
