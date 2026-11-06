import { useRef, useState } from "react";
import { AdminApi } from "../services/AdminApi";
import { ReservationApiError } from "../services/ReservationApi";
import type { ReservationDetailResponse } from "../types/reservationDetails";
import { pricePreview, reservationDraft, totalValidation } from "../utils/reservationDetails";
import { useAdminSession } from "../components/auth/RequireAdmin";

export type ReservationAction = "update" | "total" | "complete" | "grant" | "revoke" | "approved" | "rejected";

export default function useReservationEditor(initialData: ReservationDetailResponse) {
    const [data, setData] = useState(initialData);
    const [draft, setDraft] = useState(() => reservationDraft(initialData));
    const [editing, setEditing] = useState<"booking" | "total" | null>(null);
    const [total, setTotal] = useState(initialData.reservation.total ?? "");
    const [agreedDeadline, setAgreedDeadline] = useState(initialData.reservation.extension_access?.agreed_deadline.slice(0, 10) ?? "");
    const [confirmation, setConfirmation] = useState<ReservationAction | null>(null);
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [refreshRequired, setRefreshRequired] = useState(false);
    const { revalidate } = useAdminSession();
    const r = data.reservation;
    const dirty = editing === "booking" ? JSON.stringify(draft) !== JSON.stringify(reservationDraft(data)) : editing === "total" && total !== (r.total ?? "");

    function accept(fresh: ReservationDetailResponse) {
        setData(fresh); setDraft(reservationDraft(fresh)); setTotal(fresh.reservation.total ?? ""); setEditing(null); setConfirmation(null); setRefreshRequired(false);
        setAgreedDeadline(fresh.reservation.extension_access?.agreed_deadline.slice(0, 10) ?? "");
    }
    function cancel() { setDraft(reservationDraft(data)); setTotal(r.total ?? ""); setEditing(null); setConfirmation(null); if (!refreshRequired) setError(null); }
    function confirmSave() {
        let errors: string[];
        if (editing === "total") errors = [totalValidation(total, r.deposit)].filter((value): value is string => Boolean(value));
        else {
            const preview = pricePreview(draft); errors = preview.errors;
            if (preview.total < Number(r.deposit)) errors.push("The final reservation price must cover the required deposit.");
            if (!draft.contact_name.trim() || !draft.contact_phone.trim() || !draft.inquiry_source.trim()) errors.push("Full name, contact number, and inquiry source are required.");
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact_email)) errors.push("Enter a valid email address.");
            if (draft.adults < 1 || draft.children < 0 || draft.pets < 0 || draft.pets > 10) errors.push("Check the guest and pet counts.");
            if (!draft.checkin || !draft.checkout || Date.parse(`${draft.checkout}T${draft.checkout_time}+08:00`) <= Date.parse(`${draft.checkin}T${draft.checkin_time}+08:00`)) errors.push("Check-out must occur after check-in.");
            if (draft.damages?.some(damage => !damage.description.trim() || !damage.item_area.trim() || !/^\d{1,8}(\.\d{1,2})?$/.test(damage.amount))) errors.push("Every damage record needs a description, item/area, and valid non-negative amount.");
        }
        setError(errors.length ? errors.join(" ") : null);
        if (!errors.length) setConfirmation(editing === "total" ? "total" : "update");
    }
    async function persist(action: ReservationAction) {
        if (pending.current || refreshRequired) return;
        pending.current = true; setBusy(true); setError(null); setNotice(null);
        let saved = false;
        try {
            let fresh: ReservationDetailResponse;
            const revision = data.details?.revision ?? 0;
            if (action === "update") fresh = await AdminApi.updateReservation(r.id, draft);
            else if (action === "complete") fresh = await AdminApi.completeReservation(r.id, revision);
            else if (action === "grant") fresh = await AdminApi.grantExtensionAccess(r.id, revision, agreedDeadline);
            else if (action === "revoke") fresh = await AdminApi.revokeExtensionAccess(r.id, revision);
            else {
                if (action === "total") await AdminApi.agreeReservationTotal(r.id, total);
                else await AdminApi.reviewExtension(r.id, action);
                saved = true;
                fresh = await AdminApi.reservation(String(r.id), new AbortController().signal);
            }
            accept(fresh);
            setNotice(action === "update" ? "Reservation updated successfully." : action === "complete" ? "Staycation completed successfully." : action === "total" ? "Agreed day-tour total saved." : action === "grant" ? "Extension request access granted. The actual deposit deadline has not changed." : action === "revoke" ? "Extension request access revoked." : `Extension request ${action}.`);
        } catch (cause) {
            if (cause instanceof ReservationApiError && [401, 403].includes(cause.status)) revalidate();
            const stale = cause instanceof ReservationApiError && cause.status === 409;
            setError(saved ? "The change was saved, but the refreshed details could not be loaded. Reload latest details before making another change." : cause instanceof Error ? cause.message : "Unable to save this change.");
            if (saved || stale) { setRefreshRequired(true); setConfirmation(null); if (saved) setEditing(null); }
        } finally { pending.current = false; setBusy(false); }
    }
    async function reload() {
        if (pending.current) return;
        pending.current = true; setBusy(true);
        try { accept(await AdminApi.reservation(String(r.id), new AbortController().signal)); setError(null); }
        catch (cause) { if (cause instanceof ReservationApiError && [401, 403].includes(cause.status)) revalidate(); setError(cause instanceof Error ? cause.message : "Unable to reload."); }
        finally { pending.current = false; setBusy(false); }
    }
    return { data, draft, setDraft, editing, setEditing, total, setTotal, agreedDeadline, setAgreedDeadline, confirmation, setConfirmation,
        busy, dirty, error, setError, notice, setNotice, refreshRequired, cancel, confirmSave, persist, reload };
}
