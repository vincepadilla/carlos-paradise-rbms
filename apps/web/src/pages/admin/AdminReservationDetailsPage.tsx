import { useCallback } from "react";
import { useParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import ReservationDetails from "../../components/admin/reservation-details/ReservationDetails";
import { AdminApi } from "../../services/AdminApi";

export default function AdminReservationDetailsPage() {
    const { id = "" } = useParams();
    const load = useCallback((signal: AbortSignal) => AdminApi.reservation(id, signal), [id]);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        return <div><h1>Reservation Details</h1><p role="alert">Invalid reservation ID.</p></div>;
    }
    return <AdminResource key={id} load={load} showRefresh={false}>{data => <ReservationDetails key={id} initialData={data} />}</AdminResource>;
}
