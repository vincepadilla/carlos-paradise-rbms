<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BookingPaymentsController;
use App\Http\Controllers\Controller;
use App\Services\PaymentReceiptStorage;
use App\Services\ReservationWorkflow;
use App\Services\ReservationPricing;
use App\Services\StaffDepositReviewEditing;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminPaymentReviewController extends Controller
{
    public function __construct(private ReservationWorkflow $flow, private PaymentReceiptStorage $receipts, private StaffDepositReviewEditing $editing) {}

    public function index(Request $request)
    {
        $data = $request->validate([
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:50',
            'scope' => ['sometimes', Rule::in(['pending', 'all'])],
            'search' => 'sometimes|nullable|string|max:255',
            'status' => ['sometimes', 'nullable', Rule::in(['verified', 'not_paid', 'awaiting_review', 'rejected'])],
            'method' => 'sometimes|nullable|string|max:255',
        ]);

        return $this->flow->locked(function () use ($data) {
            if (($data['scope'] ?? 'pending') === 'all') {
                return $this->allRecords($data);
            }

            $queue = DB::table('payments as p')->join('reservations as r', 'r.id', '=', 'p.reservation_id')
                ->where('r.villa_id', 1)->where('r.status', 'payment_review')->where('p.status', 'submitted')
                ->orderByDesc('p.id')->paginate($data['per_page'] ?? 25, ['p.id', 'p.reservation_id']);
            $queue->setCollection($queue->getCollection()->map(function ($item) {
                $reservation = $this->flow->present($this->flow->reservation($item->reservation_id));

                return ['reservation' => $reservation, 'payment' => $reservation['payments']->firstWhere('id', $item->id)];
            }));

            return response()->json($queue);
        });
    }

    private function allRecords(array $data)
    {
        $search = trim($data['search'] ?? '');
        $query = DB::table('reservations as r')->where('r.villa_id', 1);

        if ($search !== '') {
            $pattern = '%'.$search.'%';
            $query->where(function ($searchQuery) use ($pattern, $search) {
                $searchQuery->whereLike('r.booking_reference', $pattern, caseSensitive: false)
                    ->orWhereLike('r.contact_name', $pattern, caseSensitive: false)
                    ->orWhereExists(function ($payments) use ($pattern) {
                        $payments->selectRaw('1')->from('payments as search_payment')
                            ->whereColumn('search_payment.reservation_id', 'r.id')
                            ->where('search_payment.payment_kind', 'deposit')
                            ->whereLike('search_payment.reference_number', $pattern, caseSensitive: false);
                    });
                if (ctype_digit($search)) {
                    $searchQuery->orWhere('r.id', (int) $search);
                }
            });
        }

        if (! empty($data['method'])) {
            $method = $data['method'];
            $query->whereExists(function ($payments) use ($method) {
                $payments->selectRaw('1')->from('payments as method_payment')
                    ->join('payment_methods as method', 'method.id', '=', 'method_payment.payment_method_id')
                    ->whereColumn('method_payment.reservation_id', 'r.id')
                    ->where('method_payment.payment_kind', 'deposit')
                    ->where('method.name', $method);
            });
        }

        $depositExists = fn ($payments) => $payments->selectRaw('1')->from('payments as status_payment')
            ->whereColumn('status_payment.reservation_id', 'r.id')
            ->where('status_payment.payment_kind', 'deposit');
        $statusExists = fn ($status) => fn ($payments) => $depositExists($payments)->where('status_payment.status', $status);

        switch ($data['status'] ?? '') {
            case 'awaiting_review':
                $query->whereExists($statusExists('submitted'));
                break;
            case 'verified':
                $query->whereNotExists($statusExists('submitted'))->whereExists($statusExists('approved'));
                break;
            case 'rejected':
                $query->whereNotExists($statusExists('submitted'))->whereNotExists($statusExists('approved'))
                    ->whereExists($statusExists('rejected'));
                break;
            case 'not_paid':
                $query->whereNotExists($depositExists);
                break;
        }

        $records = $query->orderByDesc('r.id')->paginate($data['per_page'] ?? 10, [
            'r.id', 'r.booking_reference', 'r.contact_name', 'r.starts_at', 'r.ends_at',
        ]);
        $ids = $records->getCollection()->pluck('id');
        $payments = $ids->isEmpty() ? collect() : DB::table('payments as p')
            ->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->whereIn('p.reservation_id', $ids)->where('p.payment_kind', 'deposit')
            ->orderByDesc('p.submitted_at')->orderByDesc('p.id')
            ->get(['p.id', 'p.reservation_id', 'p.amount', 'p.status', 'p.submitted_at', 'm.name as method'])
            ->groupBy('reservation_id');

        $records->setCollection($records->getCollection()->map(function ($reservation) use ($payments) {
            $submissions = $payments->get($reservation->id, collect());
            $latest = $submissions->first();
            $status = $submissions->contains('status', 'submitted')
                ? 'awaiting_review'
                : ($submissions->contains('status', 'approved')
                    ? 'verified'
                    : ($submissions->contains('status', 'rejected') ? 'rejected' : 'not_paid'));

            return [
                'reservation_id' => $reservation->id,
                'reservation_reference' => $reservation->booking_reference,
                'guest_name' => $reservation->contact_name,
                'starts_at' => CarbonImmutable::parse($reservation->starts_at, 'Asia/Manila')->toIso8601String(),
                'ends_at' => CarbonImmutable::parse($reservation->ends_at, 'Asia/Manila')->toIso8601String(),
                'payment_method' => $latest?->method,
                'total_submitted' => $submissions->isEmpty()
                    ? null
                    : number_format((float) $submissions->sum('amount'), 2, '.', ''),
                'submitted_at' => $latest
                    ? CarbonImmutable::parse($latest->submitted_at, 'Asia/Manila')->toIso8601String()
                    : null,
                'status' => $status,
                'latest_payment_id' => $latest?->id,
            ];
        }));

        $methods = DB::table('payment_methods')->distinct()->orderBy('name')->pluck('name')->values();

        return response()->json([
            ...$records->toArray(),
            'filters' => [
                'statuses' => [
                    ['value' => 'verified', 'label' => 'Verified'],
                    ['value' => 'not_paid', 'label' => 'Not Yet Paid'],
                    ['value' => 'awaiting_review', 'label' => 'Awaiting Review'],
                    ['value' => 'rejected', 'label' => 'Rejected'],
                ],
                'methods' => $methods,
            ],
        ]);
    }

    public function show(int $reservation)
    {
        return $this->flow->locked(function () use ($reservation) {
            $record = $this->flow->reservation($reservation);
            $data = $this->flow->present($record);
            $receipts = DB::table('payments')->where('reservation_id', $reservation)->get()
                ->mapWithKeys(fn ($payment) => [$payment->id => $this->receipts->describe($payment)]);

            $methods = DB::table('payment_methods')->where('is_active', true)->orderBy('name')->pluck('name')->values();
            $snapshot = json_decode($record->pricing_snapshot ?: '{}', true);
            $snapshot = is_array($snapshot) ? $snapshot : [];
            $editing = null;
            if ($data['staff_editable']) {
                $editing = ['pricing' => collect(ReservationPricing::CHARGES)->mapWithKeys(fn ($key) => [$key => number_format((float) ($snapshot[$key] ?? 0), 2, '.', '')])->all(),
                    'discount' => $snapshot['discount'] ?? ['type' => 'none', 'value' => '0.00', 'justification' => null]];
            }

            return response()->json(['reservation' => $data, 'receipts' => (object) $receipts->all(), 'payment_methods' => $methods, 'editing' => $editing,
                'can_approve_payments' => $this->editing->canApprovePayments(request()->user())]);
        });
    }

    public function updateReservation(Request $request, int $reservation)
    {
        $money = ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999'];
        $rules = [
            'revision' => 'required|integer|min:0', 'reason' => 'required|string|min:3|max:1000',
            'contact_name' => 'required|string|max:255', 'contact_email' => 'required|email:rfc|max:254',
            'contact_phone' => ['required', 'string', 'regex:/^09[0-9]{9}$/'], 'type' => ['required', Rule::in(['overnight', 'day_tour'])],
            'checkin' => 'required|date_format:Y-m-d', 'checkout' => 'required|date_format:Y-m-d',
            'checkin_time' => 'required|date_format:H:i', 'checkout_time' => 'required|date_format:H:i',
            'adults' => 'required|integer|min:1|max:1000', 'children' => 'required|integer|min:0|max:1000', 'pets' => 'required|integer|min:0|max:10',
            'bonfire_qty' => 'required|integer|min:0|max:20', 'charcoal_qty' => 'required|integer|min:0|max:100', 'liquor_qty' => 'required|integer|min:0|max:100',
            'notes' => 'nullable|string|max:2000', 'pricing' => 'required|array:'.implode(',', ReservationPricing::CHARGES),
            'discount' => 'required|array:type,value,justification', 'discount.type' => ['required', Rule::in(['none', 'percentage', 'fixed'])],
            'discount.value' => $money, 'discount.justification' => 'nullable|required_unless:discount.type,none|string|min:3|max:2000',
        ];
        foreach (ReservationPricing::CHARGES as $charge) $rules['pricing.'.$charge] = $money;
        $this->editing->updateReservation($reservation, $request->user()->id, $request->validate($rules));

        return $this->show($reservation);
    }

    public function updateTerms(Request $request, int $reservation)
    {
        $data = $request->validate([
            'revision' => 'required|integer|min:0', 'reason' => 'required|string|min:3|max:1000',
            'required_deposit' => ['required', 'numeric', 'decimal:0,2', 'min:1', 'max:99999999'],
            'deadline' => 'required|date', 'partial_payment_authorized' => 'required|boolean',
            'partial_payment_terms' => 'nullable|string|max:2000',
        ]);
        $this->editing->updateTerms($reservation, $request->user()->id, $data);

        return $this->show($reservation);
    }

    public function updatePayment(Request $request, int $reservation, int $payment)
    {
        $data = $request->validate([
            'revision' => 'required|integer|min:0', 'payment_revision' => 'required|integer|min:0',
            'reason' => 'required|string|min:3|max:1000', 'amount' => ['required', 'numeric', 'decimal:0,2', 'min:1', 'max:99999999'],
            'method' => 'required|string|max:255', 'reference' => 'required|string|min:5|max:100',
            'payment_date' => 'required|date_format:Y-m-d|before_or_equal:'.now('Asia/Manila')->toDateString(),
            'notes' => 'nullable|string|max:2000', 'receipt' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:5120',
        ]);
        $this->editing->updatePayment($reservation, $payment, $request->user()->id, $data, $request->file('receipt'));

        return $this->show($reservation);
    }

    public function recordCash(Request $request, int $reservation)
    {
        $data = $request->validate([
            'revision' => 'required|integer|min:0', 'request_key' => 'required|uuid',
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'received_at' => 'required|date', 'receipt_number' => 'required|string|min:1|max:100',
            'notes' => 'nullable|string|max:2000', 'confirmed_received' => 'accepted',
            'receipt' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:5120',
        ]);
        $this->editing->recordCash($reservation, $request->user(), $data, $request->file('receipt'));

        return $this->show($reservation);
    }

    public function review(Request $request, int $reservation, int $payment, BookingPaymentsController $payments)
    {
        $this->flow->reservation($reservation);

        return $payments->review($request, $payment, $reservation);
    }

    public function receipt(int $reservation, int $payment)
    {
        $this->flow->reservation($reservation);
        $record = DB::table('payments')->where('id', $payment)->where('reservation_id', $reservation)->first();
        abort_unless($record, 404, 'Payment not found for this reservation.');

        return $this->receipts->serve($record, true);
    }
}
