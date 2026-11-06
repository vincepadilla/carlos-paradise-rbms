import type { AdminReservation } from "./admin";

export type RecordedPrice = string | null;
export type DamageRecord = { id?: number; description: string; item_area: string; amount: string; notes: string | null; created_by?: number; created_at?: string };
export type Discount = { type: "none" | "percentage" | "fixed"; value: string; amount?: string; justification: string | null; applied_by?: number; applied_at?: string };
export type PriceKey = "base" | "holiday_fee" | "extra_fee" | "cleaning_fee" | "bonfire" | "charcoal" | "liquor" | "other";
export type ReservationEdit = {
    revision: number; contact_name: string; contact_email: string; contact_phone: string; contact_address: string;
    inquiry_source: string; type: "overnight" | "day_tour"; checkin: string; checkout: string; checkin_time: string; checkout_time: string;
    adults: number; children: number; pets: number; notes: string; pricing: Record<PriceKey, string>;
    discount: Pick<Discount, "type" | "value" | "justification">; damages?: DamageRecord[];
};
export type ReservationDetailData = {
    inquiry_source: string | null;
    bonfire_qty: number;
    charcoal_qty: number;
    contact_address?: string | null;
    revision?: number;
    capabilities?: { can_edit: boolean; can_manage_damages: boolean; can_complete: boolean; can_grant_extension: boolean };
    damages?: DamageRecord[];
    configured_security_deposit?: RecordedPrice;
    totals?: { damage_total: string; paid: string; amount_due: RecordedPrice; credit_balance: RecordedPrice };
    pricing: {
        base: RecordedPrice; holiday_fee: RecordedPrice; extra_fee: RecordedPrice;
        cleaning_fee: RecordedPrice; optional_fee: RecordedPrice; bonfire: RecordedPrice;
        charcoal: RecordedPrice; security_deposit: RecordedPrice;
        liquor?: RecordedPrice; other?: RecordedPrice; discount?: Discount | null; version?: number | null;
    };
};
export type ReservationDetailResponse = { reservation: AdminReservation; details?: ReservationDetailData };
