<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\QueueReport;
use App\Services\ReportKpis;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Response;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminQueueReportsController extends Controller
{
    public function index(Request $request, QueueReport $report, ReportKpis $kpis)
    {
        $filters = $this->filters($request, $report);
        $records = $report->query($filters)->paginate((int) ($request->validate([
            'per_page' => 'sometimes|integer|min:1|max:5',
        ])['per_page'] ?? 5));
        $records->setCollection($report->present($records->getCollection()));
        return response()->json([
            ...$records->toArray(), 'filters' => ['applied' => $filters, 'statuses' => QueueReport::STATUSES],
            'analytics' => $report->analytics($filters), 'kpis' => $kpis->calculate($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function printData(Request $request, QueueReport $report, ReportKpis $kpis)
    {
        $filters = $this->filters($request, $report);
        $records = $report->present($report->query($filters)->get());
        return response()->json([
            'data' => $records, 'total' => $records->count(),
            'filters' => ['applied' => $filters, 'statuses' => QueueReport::STATUSES],
            'analytics' => $report->analytics($filters), 'kpis' => $kpis->calculate($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function export(Request $request, QueueReport $report): StreamedResponse
    {
        $filters = $this->filters($request, $report);
        return Response::streamDownload(function () use ($filters, $report) {
            $handle = fopen('php://output', 'wb');
            fputcsv($handle, ['Reservation ID', 'Check-in', 'Check-out', 'Queue Position', 'Queue Status', 'Queue Event', 'Deadline'], ',', chr(34), '');
            $report->query($filters)->chunk(500, function ($records) use ($handle, $report) {
                foreach ($report->present($records) as $row) {
                    $values = [$row['booking_reference'], $row['check_in_date'], $row['check_out_date'], $row['queue_position'], $row['status'], $row['event_date'], $row['deadline']];
                    fputcsv($handle, array_map(fn ($value) => preg_match('/^[=+\-@\t\r]/u', (string) $value) ? chr(39).(string) $value : (string) $value, $values), ',', chr(34), '');
                }
            });
            fclose($handle);
        }, 'queue-report-'.CarbonImmutable::now('Asia/Manila')->format('Y-m-d-His').'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store, private',
        ]);
    }

    private function filters(Request $request, QueueReport $report): array
    {
        return $report->filters($request->validate([
            'search' => 'sometimes|nullable|string|max:255',
            'date_range' => ['sometimes', Rule::in(['all', 'this_month', 'last_month', 'this_year', 'custom'])],
            'status' => ['sometimes', 'nullable', Rule::in(QueueReport::STATUSES)],
            'period' => ['sometimes', 'nullable', 'regex:/^\d{4}-\d{2}(-\d{2})?$/'],
            'category' => ['sometimes', 'nullable', Rule::in(['waiting', 'active_opportunities', 'moved_from_queue', 'expired_opportunities'])],
            'start_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom',
            'end_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom|after_or_equal:start_date',
        ]));
    }
}
