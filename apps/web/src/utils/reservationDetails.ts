import { money } from "../api.ts";
import type { AdminReservation } from "../types/admin";
import type { PriceKey, ReservationDetailData, ReservationDetailResponse, ReservationEdit } from "../types/reservationDetails";

export const priceFields: { key: PriceKey; label: string }[] = [
    { key: "base", label: "Base Reservation Price" }, { key: "holiday_fee", label: "Holiday Surcharge" },
    { key: "extra_fee", label: "Additional Guest Charges" }, { key: "cleaning_fee", label: "Cleaning Fee" },
    { key: "bonfire", label: "Bonfire Wood" }, { key: "charcoal", label: "Charcoal" },
    { key: "liquor", label: "Liquor Amount" }, { key: "other", label: "Other Agreed Charge" },
];
export function bookingLocalTime(value: string) {
    return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
}
export function reservationDraft(data: ReservationDetailResponse): ReservationEdit {
    const r = data.reservation, d = data.details;
    const start = bookingLocalTime(r.starts_at), end = bookingLocalTime(r.ends_at);
    return {
        revision: d?.revision ?? 0, contact_name: r.contact_name, contact_email: r.contact_email, contact_phone: r.contact_phone,
        contact_address: d?.contact_address ?? "", inquiry_source: d?.inquiry_source ?? "", type: r.type,
        checkin: start.slice(0, 10), checkout: end.slice(0, 10), checkin_time: start.slice(11), checkout_time: end.slice(11),
        adults: r.adults, children: r.children, pets: r.pets, notes: r.notes ?? "",
        pricing: Object.fromEntries(priceFields.map(({ key }) => [key, key === "base" && r.type === "day_tour" && d?.pricing.version !== 2 ? "" : d?.pricing[key] ?? ""])) as Record<PriceKey, string>,
        discount: { type: d?.pricing.discount?.type ?? "none", value: d?.pricing.discount?.value ?? "0", justification: d?.pricing.discount?.justification ?? "" },
        ...(d?.capabilities?.can_manage_damages ? { damages: (d.damages ?? []).map(({ id, description, item_area, amount, notes }) => ({ id, description, item_area, amount, notes })) } : {}),
    };
}
export function pricePreview(draft: ReservationEdit): { total: number; discount: number; errors: string[] } {
    const errors: string[] = [];
    const charges = priceFields.map(({ key, label }) => {
        const value = draft.pricing[key];
        if (!/^\d{1,8}(\.\d{1,2})?$/.test(value) || Number(value) > 99_999_999) errors.push(`${label}: enter a non-negative amount with up to two decimal places.`);
        return Math.round(Number(value) * 100) || 0;
    });
    const value = Number(draft.discount.value);
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(draft.discount.value) || !Number.isFinite(value) || value < 0) errors.push("Enter a valid discount value.");
    if (draft.discount.type === "percentage" && value > 100) errors.push("Percentage discounts cannot exceed 100%.");
    if (draft.discount.type === "fixed" && Math.round(value * 100) > charges[0]) errors.push("A fixed discount cannot exceed the base reservation price.");
    if (draft.discount.type !== "none" && (draft.discount.justification?.trim().length ?? 0) < 3) errors.push("Discount justification is required (at least 3 characters).");
    const discount = draft.discount.type === "percentage" ? Math.round(charges[0] * value / 100) : draft.discount.type === "fixed" ? Math.round(value * 100) : 0;
    return { total: (charges.reduce((sum, value) => sum + value, 0) - discount) / 100, discount: discount / 100, errors };
}

export const recordedMoney = (value: string | number | null | undefined) => value == null ? "Not recorded" : money(value);
export function reservationDisplayStatus(reservation: AdminReservation, now = Date.now()): string {
    if (reservation.status === "confirmed" && Date.parse(reservation.starts_at) <= now && Date.parse(reservation.ends_at) > now) return "ongoing";
    return reservation.status;
}
export function canAgreeTotal(reservation: AdminReservation, now = Date.now()): boolean {
    return reservation.type === "day_tour" && ["pending", "queued", "awaiting_deposit"].includes(reservation.status) && Date.parse(reservation.ends_at) > now;
}
export function totalValidation(value: string, deposit: string): string | null {
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(value) || Number(value) < 1 || Number(value) > 99_999_999) return "Enter a valid total between ₱1 and ₱99,999,999, with up to two decimal places.";
    if (Math.round(Number(value) * 100) < Math.round(Number(deposit) * 100)) return "The total must cover the required deposit.";
    return null;
}
export function approvedPayments(reservation: AdminReservation): number | null {
    if (!Array.isArray(reservation.payments)) return null;
    return reservation.payments.filter(payment => payment.status === "approved").reduce((cents, payment) => cents + Math.round(Number(payment.amount) * 100), 0) / 100;
}
export function priceLines(details?: ReservationDetailData, type?: AdminReservation["type"]): { label: string; value: string | null }[] {
    const pricing = details?.pricing;
    return [
        // Day-tour quotes contain a provisional zero base; only the agreed total is authoritative.
        { label: "Base Reservation Price", value: type === "day_tour" && pricing?.version !== 2 ? null : pricing?.base ?? null },
        { label: "Holiday Surcharge", value: pricing?.holiday_fee ?? null },
        { label: "Additional Guest Charges", value: pricing?.extra_fee ?? null },
        { label: "Cleaning Fee", value: pricing?.cleaning_fee ?? null },
        { label: "Bonfire Wood", value: pricing?.bonfire ?? null },
        { label: "Charcoal", value: pricing?.charcoal ?? null },
        ...(pricing?.optional_fee != null && (pricing.bonfire == null || pricing.charcoal == null) ? [{ label: "Optional Charges (combined)", value: pricing.optional_fee }] : []),
        { label: "Liquor Amount", value: pricing?.liquor ?? null }, { label: "Other Agreed Charge", value: pricing?.other ?? null },
    ];
}
