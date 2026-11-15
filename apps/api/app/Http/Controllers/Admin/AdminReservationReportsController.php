<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReservationReport;
use App\Services\ReportKpis;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AdminReservationReportsController extends Controller
{
    public function index(Request $request, ReservationReport $report, ReportKpis $kpis)
    {
        $filters = $this->validatedFilters($request, $report);
        $pagination = $request->validate([
            'per_page' => 'sometimes|integer|min:1|max:5',
        ]);
        $perPage = (int) ($pagination['per_page'] ?? 5);
        $records = $report->query($filters)->paginate($perPage);
        $records->setCollection($report->presentCollection($records->getCollection()));

        $response = [
            ...$records->toArray(),
            'filters' => $this->metadata($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ];
        if ($request->boolean('dashboard')) {
            $response['analytics'] = $report->analytics($filters);
            $response['kpis'] = $kpis->calculate($filters);
        }
        return response()->json($response);
    }

    public function guestIndex(Request $request, ReservationReport $report, ReportKpis $kpis)
    {
        if (! $request->boolean('dashboard')) return $this->index($request, $report, $kpis);
        $filters = $this->validatedFilters($request, $report);
        $perPage = (int) ($request->validate(['per_page' => 'sometimes|integer|min:1|max:5'])['per_page'] ?? 5);
        $records = $report->guestQuery($filters)->paginate($perPage);
        $records->setCollection($report->presentGuestCollection($records->getCollection()));
        return response()->json([
            ...$records->toArray(),
            'filters' => $this->metadata($filters),
            'analytics' => $report->guestAnalytics($filters),
            'kpis' => $kpis->calculate($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function printData(Request $request, ReservationReport $report, ReportKpis $kpis)
    {
        $filters = $this->validatedFilters($request, $report);
        $records = $report->presentCollection($report->query($filters)->get());

        return response()->json([
            'data' => $records,
            'total' => $records->count(),
            'filters' => $this->metadata($filters),
            'analytics' => $request->boolean('dashboard') ? $report->analytics($filters) : null,
            'kpis' => $request->boolean('dashboard') ? $kpis->calculate($filters) : null,
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function guestPrintData(Request $request, ReservationReport $report, ReportKpis $kpis)
    {
        if (! $request->boolean('dashboard')) return $this->printData($request, $report, $kpis);
        $filters = $this->validatedFilters($request, $report);
        $records = $report->presentGuestCollection($report->guestQuery($filters)->get());
        return response()->json([
            'data' => $records,
            'total' => $records->count(),
            'filters' => $this->metadata($filters),
            'analytics' => $report->guestAnalytics($filters),
            'kpis' => $kpis->calculate($filters),
            'generated_at' => CarbonImmutable::now('Asia/Manila')->toIso8601String(),
        ]);
    }

    public function export(Request $request, ReservationReport $report): StreamedResponse
    {
        return $this->exportResponse($request, $report, false);
    }

    public function guestExport(Request $request, ReservationReport $report): StreamedResponse
    {
        return $this->exportResponse($request, $report, true);
    }

    private function exportResponse(Request $request, ReservationReport $report, bool $guestReport): StreamedResponse
    {
        $filters = $this->validatedFilters($request, $report);
        if ($guestReport && $request->boolean('dashboard')) return $this->dashboardGuestExport($report, $filters);
        $generated = CarbonImmutable::now('Asia/Manila');
        $filename = ($guestReport ? 'guest-report-' : 'reservation-report-').$generated->format('Y-m-d-His').'.csv';

        return Response::streamDownload(function () use ($report, $filters, $guestReport) {
            $handle = fopen('php://output', 'wb');
            $reservationHeaders = [
                'Guest', 'Backend Reservation ID', 'Reservation ID', 'Check-in Date', 'Check-out Date',
                'Total Guests', 'Adults', 'Children', 'Reservation Status', 'Payment State',
                'Submitted Amount', 'Verified Amount', 'Required Deposit', 'Base Amount',
                'Discount Amount', 'Discount Status', 'Final Amount', 'Requested At',
            ];
            $guestHeaders = [
                'Guest', 'Backend Reservation ID', 'Reservation ID', 'Check-in Date', 'Check-out Date',
                'Total Guests', 'Adults', 'Children', 'Reservation Status',
            ];
            fputcsv($handle, $guestReport ? $guestHeaders : $reservationHeaders, ',', '"', '');

            $report->query($filters)->chunk(500, function ($records) use ($handle, $report, $guestReport) {
                foreach ($report->presentCollection($records) as $record) {
                    $reservationRow = [
                        $record['guest_name'],
                        $record['id'],
                        $record['booking_reference'],
                        $record['check_in_date'],
                        $record['check_out_date'],
                        $record['guest_count'],
                        $record['adults'],
                        $record['children'],
                        $record['status'],
                        $record['payment']['state'],
                        $record['payment']['submitted_amount'],
                        $record['payment']['verified_amount'],
                        $record['payment']['required_amount'],
                        $record['pricing']['base_amount'],
                        $record['pricing']['discount_amount'],
                        $record['pricing']['discount_confirmed_none'] ? 'No discount applied' : $record['pricing']['discount_type'],
                        $record['pricing']['final_amount'],
                        $record['requested_at'],
                    ];
                    $guestRow = array_slice($reservationRow, 0, 9);
                    fputcsv($handle, array_map([$this, 'csvValue'], $guestReport ? $guestRow : $reservationRow), ',', '"', '');
                }
            });

            fclose($handle);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    private function dashboardGuestExport(ReservationReport $report, array $filters): StreamedResponse
    {
        $filename = 'guest-report-'.CarbonImmutable::now('Asia/Manila')->format('Y-m-d-His').'.csv';
        return Response::streamDownload(function () use ($report, $filters) {
            $handle = fopen('php://output', 'wb');
            fputcsv($handle, ['Guest', 'Email', 'Phone', 'Reservations in Period', 'Successful Reservations', 'All-time Reservations', 'First Stay', 'Latest Stay', 'Associated Reservation'], ',', chr(34), '');
            $report->guestQuery($filters)->chunk(500, function ($records) use ($handle, $report) {
                foreach ($report->presentGuestCollection($records) as $row) {
                    $values = [$row['guest_name'], $row['guest_email'], $row['guest_phone'], $row['reservation_count'], $row['successful_reservations'], $row['history_reservation_count'], $row['first_stay_date'], $row['latest_stay_date'], $row['associated_booking_reference']];
                    fputcsv($handle, array_map([$this, 'csvValue'], $values), ',', chr(34), '');
                }
            });
            fclose($handle);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store, private']);
    }

    private function validatedFilters(Request $request, ReservationReport $report): array
    {
        $data = $request->validate([
            'search' => 'sometimes|nullable|string|max:255',
            'date_range' => ['sometimes', Rule::in(ReservationReport::DATE_RANGES)],
            'status' => ['sometimes', 'nullable', Rule::in(ReservationReport::STATUSES)],
            'period' => ['sometimes', 'nullable', 'regex:/^\d{4}-\d{2}(-\d{2})?$/'],
            'guest_type' => ['sometimes', 'nullable', Rule::in(['new', 'returning'])],
            'frequency' => ['sometimes', 'nullable', Rule::in(['1', '2', '2+', '3-4', '5+'])],
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
            'statuses' => ReservationReport::STATUSES,
            'date_ranges' => ReservationReport::DATE_RANGES,
        ];
    }

    public function csvValue(mixed $value): string
    {
        $text = $value === null ? '' : (string) $value;

        return preg_match('/^[=+\-@\t\r]/u', $text) === 1 ? "'".$text : $text;
    }
}
