<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PaymentReport;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminPaymentReportsController extends Controller
{
    public function index(Request $request, PaymentReport $report)
    {
        $filters = $this->validatedFilters($request, $report);
        $pagination = $request->validate([
            'per_page' => 'sometimes|integer|min:1|max:100',
        ]);
        $records = $report->query($filters)->paginate((int) ($pagination['per_page'] ?? 15));
        $records->setCollection($report->presentCollection($records->getCollection()));

        return response()->json([
            ...$records->toArray(),
            'filters' => $this->metadata($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function printData(Request $request, PaymentReport $report)
    {
        $filters = $this->validatedFilters($request, $report);
        $records = $report->presentCollection($report->query($filters)->get());

        return response()->json([
            'data' => $records,
            'total' => $records->count(),
            'filters' => $this->metadata($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function export(Request $request, PaymentReport $report): StreamedResponse
    {
        $filters = $this->validatedFilters($request, $report);
        $filename = 'payment-report-'.CarbonImmutable::now('Asia/Manila')->format('Y-m-d-His').'.csv';

        return Response::streamDownload(function () use ($report, $filters) {
            $handle = fopen('php://output', 'wb');
            fputcsv($handle, [
                'Backend Reservation ID', 'Reservation ID', 'Check-in Date', 'Check-out Date',
                'Total Guests', 'Adults', 'Children', 'Payment Status', 'Submitted Awaiting Review',
                'Verified Amount', 'Required Deposit', 'Methods',
            ], ',', '"', '');

            $report->query($filters)->chunk(500, function ($records) use ($handle, $report) {
                foreach ($report->presentCollection($records) as $record) {
                    fputcsv($handle, array_map([$this, 'csvValue'], [
                        $record['id'],
                        $record['booking_reference'],
                        $record['check_in_date'],
                        $record['check_out_date'],
                        $record['guest_count'],
                        $record['adults'],
                        $record['children'],
                        $record['payment_status'],
                        $record['submitted_amount'],
                        $record['verified_amount'],
                        $record['required_amount'],
                        implode(', ', $record['methods']),
                    ]), ',', '"', '');
                }
            });

            fclose($handle);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    private function validatedFilters(Request $request, PaymentReport $report): array
    {
        $data = $request->validate([
            'search' => 'sometimes|nullable|string|max:255',
            'date_range' => ['sometimes', Rule::in(PaymentReport::DATE_RANGES)],
            'payment_status' => ['sometimes', 'nullable', Rule::in(PaymentReport::STATUSES)],
            'start_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom',
            'end_date' => 'nullable|date_format:Y-m-d|required_if:date_range,custom',
        ]);

        if (($data['date_range'] ?? 'this_month') === 'custom'
            && isset($data['start_date'], $data['end_date'])
            && $data['end_date'] < $data['start_date']) {
            throw ValidationException::withMessages([
                'end_date' => 'The custom end date must be on or after the start date.',
            ]);
        }

        return $report->filters($data);
    }

    private function metadata(array $filters): array
    {
        return [
            'applied' => $filters,
            'statuses' => PaymentReport::STATUSES,
            'date_ranges' => PaymentReport::DATE_RANGES,
        ];
    }

    public function csvValue(mixed $value): string
    {
        $text = $value === null ? '' : (string) $value;

        return preg_match('/^[=+\-@\t\r]/u', $text) === 1 ? "'".$text : $text;
    }
}
