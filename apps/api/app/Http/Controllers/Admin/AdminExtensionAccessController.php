<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BookingReservationsController;
use App\Http\Controllers\Controller;
use App\Services\ReservationExtensionAccess;
use Illuminate\Http\Request;

class AdminExtensionAccessController extends Controller
{
    public function store(Request $request, int $reservation, ReservationExtensionAccess $access, BookingReservationsController $read)
    {
        $data = $request->validate(['revision' => 'required|integer|min:0', 'agreed_deadline' => 'required|date_format:Y-m-d']);
        $access->grant($reservation, $request->user()->id, $data['revision'], $data['agreed_deadline']);

        return $read->show($request, $reservation);
    }

    public function destroy(Request $request, int $reservation, ReservationExtensionAccess $access, BookingReservationsController $read)
    {
        $data = $request->validate(['revision' => 'required|integer|min:0']);
        $access->revoke($reservation, $request->user()->id, $data['revision']);

        return $read->show($request, $reservation);
    }
}
