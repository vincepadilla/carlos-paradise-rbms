<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BookingReservationsController;
use App\Http\Controllers\Controller;
use App\Services\ReservationManagement;
use App\Services\ReservationPricing;
use App\Services\ReservationWorkflow;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminReservationManagementController extends Controller
{
    public function index(Request $request, ReservationWorkflow $flow)
    {
        $data = $request->validate([
            'page' => 'sometimes|integer|min:1',
            'per_page' => 'sometimes|integer|min:1|max:100',
            'search' => 'sometimes|nullable|string|max:255',
            'status' => 'sometimes|nullable|string|max:30',
            'type' => 'sometimes|nullable|string|max:20',
        ]);

        $search = trim($data['search'] ?? '');

        return $flow->locked(function () use ($data, $search, $flow) {
            $base = DB::table('reservations')->where('villa_id', 1);
            $statuses = (clone $base)->whereNotNull('status')->distinct()->orderBy('status')->pluck('status')->values();
            $types = (clone $base)->whereNotNull('type')->distinct()->orderBy('type')->pluck('type')->values();

            $query = clone $base;
            if ($search !== '') {
                $pattern = '%'.$search.'%';
                $query->where(function ($searchQuery) use ($pattern) {
                    $searchQuery->whereLike('contact_name', $pattern, caseSensitive: false)
                        ->orWhereLike('booking_reference', $pattern, caseSensitive: false);
                });
            }
            if (! empty($data['status'])) $query->where('status', $data['status']);
            if (! empty($data['type'])) $query->where('type', $data['type']);

            $reservations = $query->orderByDesc('id')->paginate($data['per_page'] ?? 10);
            $reservations->setCollection($reservations->getCollection()->map(fn ($reservation) => $flow->present($reservation)));

            return response()->json([
                ...$reservations->toArray(),
                'filters' => ['statuses' => $statuses, 'types' => $types],
            ]);
        });
    }

    public function update(Request $request, int $reservation, ReservationManagement $management, BookingReservationsController $read)
    {
        $money = ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999'];
        $rules = [
            'revision' => 'required|integer|min:0', 'contact_name' => 'required|string|max:255',
            'contact_email' => 'required|email|max:255', 'contact_phone' => 'required|string|max:30',
            'contact_address' => 'nullable|string|max:2000', 'inquiry_source' => 'required|string|max:100',
            'type' => ['required', Rule::in(['overnight', 'day_tour'])],
            'checkin' => 'required|date_format:Y-m-d', 'checkout' => 'required|date_format:Y-m-d',
            'checkin_time' => 'required|date_format:H:i', 'checkout_time' => 'required|date_format:H:i',
            'adults' => 'required|integer|min:1|max:1000', 'children' => 'required|integer|min:0|max:1000',
            'pets' => 'required|integer|min:0|max:10', 'notes' => 'nullable|string|max:2000',
            'pricing' => 'required|array:'.implode(',', ReservationPricing::CHARGES),
            'discount' => 'required|array:type,value,justification',
            'discount.type' => ['required', Rule::in(['none', 'percentage', 'fixed'])], 'discount.value' => $money,
            'discount.justification' => 'nullable|required_unless:discount.type,none|string|min:3|max:2000',
            'damages' => 'sometimes|array|max:100', 'damages.*' => 'array:id,description,item_area,amount,notes',
            'damages.*.id' => 'nullable|integer|min:1|distinct', 'damages.*.description' => 'required|string|max:1000',
            'damages.*.item_area' => 'required|string|max:255', 'damages.*.amount' => $money, 'damages.*.notes' => 'nullable|string|max:2000',
        ];
        foreach (ReservationPricing::CHARGES as $charge) $rules['pricing.'.$charge] = $money;
        foreach (['status', 'total', 'quoted_total', 'required_deposit', 'deposit_paid', 'payments', 'user_id'] as $protected) $rules[$protected] = 'prohibited';
        $management->update($reservation, $request->user()->id, $request->validate($rules));

        return $read->show($request, $reservation);
    }

    public function complete(Request $request, int $reservation, ReservationManagement $management, BookingReservationsController $read)
    {
        $data = $request->validate(['revision' => 'required|integer|min:0']);
        $management->complete($reservation, $request->user()->id, $data['revision']);

        return $read->show($request, $reservation);
    }
}
