<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\OcularVisitReport;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Response;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminOcularVisitReportsController extends Controller
{
    public function index(Request $request, OcularVisitReport $report)
    {
        $filters = $this->filters($request, $report);
        $perPage = (int) ($request->validate(['per_page' => 'sometimes|integer|min:1|max:5'])['per_page'] ?? 5);
        $records = $report->query($filters)->paginate($perPage);
        $records->setCollection($report->present($records->getCollection()));

        return response()->json([
            ...$records->toArray(),
            'filters' => ['applied' => $filters, 'statuses' => OcularVisitReport::STATUSES],
            'analytics' => $report->analytics($filters),
            'kpis' => $this->emptyKpis($filters['date_label']),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function printData(Request $request, OcularVisitReport $report)
    {
        $filters = $this->filters($request, $report);
        $records = $report->present($report->query($filters)->get());
        return response()->json([
            'data' => $records,
            'total' => $records->count(),
            'filters' => ['applied' => $filters, 'statuses' => OcularVisitReport::STATUSES],
            'analytics' => $report->analytics($filters),
            'kpis' => $this->emptyKpis($filters['date_label']),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function export(Request $request, OcularVisitReport $report): StreamedResponse
    {
        $filters = $this->filters($request, $report);
        return Response::streamDownload(function () use ($filters, $report) {
            $handle = fopen('php://output', 'wb');
            fputcsv($handle, ['Visit Reference', 'Visitor Name', 'Visit Date', 'Start Time', 'End Time', 'Status', 'Assigned Staff'], ',', chr(34), '');
            $report->query($filters)->chunk(500, function ($records) use ($handle, $report) {
                foreach ($report->present($records) as $row) {
                    $values = [$row['visit_reference'], $row['visitor_name'], $row['visit_date'], $row['start_time'], $row['end_time'], $row['status'], $row['assigned_staff']];
                    fputcsv($handle, array_map([$this, 'csvValue'], $values), ',', chr(34), '');
                }
            });
            fclose($handle);
        }, 'ocular-visit-report-'.CarbonImmutable::now('Asia/Manila')->format('Y-m-d-His').'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    private function filters(Request $request, OcularVisitReport $report): array
    {
        return $report->filters($request->validate([
            'search' => 'sometimes|nullable|string|max:255',
            'date_range' => ['sometimes', Rule::in(OcularVisitReport::DATE_RANGES)],
            'status' => ['sometimes', 'nullable', Rule::in(OcularVisitReport::STATUSES)],
            'period' => ['sometimes', 'nullable', 'regex:/^\d{4}-\d{2}(-\d{2})?$/'],
            'start_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom',
            'end_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom|after_or_equal:start_date',
        ]));
    }

    private function emptyKpis(string $scope): array
    {
        return [
            'scope_label' => $scope,
            'total_reservations' => 0,
            'confirmed_reservations' => 0,
            'verified_payments' => '0.00',
            'pending_deposit_reviews' => 0,
        ];
    }

    private function csvValue(mixed $value): string
    {
        $text = $value === null ? '' : (string) $value;
        return preg_match('/^[=+\-@\t\r]/u', $text) ? chr(39).$text : $text;
    }
}
