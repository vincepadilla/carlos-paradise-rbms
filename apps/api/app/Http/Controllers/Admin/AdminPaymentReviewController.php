<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BookingPaymentsController;
use App\Http\Controllers\Controller;
use App\Services\PaymentReceiptStorage;
use App\Services\ReservationWorkflow;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminPaymentReviewController extends Controller
{
    public function __construct(private ReservationWorkflow $flow, private PaymentReceiptStorage $receipts) {}

    public function index(Request $request)
    {
        $data = $request->validate(['page' => 'sometimes|integer|min:1', 'per_page' => 'sometimes|integer|min:1|max:50']);

        return $this->flow->locked(function () use ($data) {
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

    public function show(int $reservation)
    {
        return $this->flow->locked(function () use ($reservation) {
            $data = $this->flow->present($this->flow->reservation($reservation));
            $receipts = DB::table('payments')->where('reservation_id', $reservation)->get()
                ->mapWithKeys(fn ($payment) => [$payment->id => $this->receipts->describe($payment)]);

            return response()->json(['reservation' => $data, 'receipts' => (object) $receipts->all()]);
        });
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
