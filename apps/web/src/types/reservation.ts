import type { Settings } from "../api";

export type PaymentMethod = {
    id: number;
    name: string;
    account_name: string;
    account_number: string;
    qr_code_url?: string | null;
    instructions: string | null;
};
export type Payment = {
    id: number;
    amount: string;
    method: string;
    reference: string;
    status: string;
    review_note: string | null;
    payment_date?: string | null;
    submitted_at?: string | null;
    reviewed_at?: string | null;
    reviewed_by?: number | null;
    submitted_by?: number;
    staff_notes?: string | null;
    revision?: number;
    staff_recorded?: boolean;
};
export type SavedReservation = {
    id: number;
    reference: string;
    status: string;
    queue_notice?: string | null;
    queue_position?: number | null;
    reservations_ahead?: number | null;
    type: "overnight" | "day_tour";
    starts_at: string;
    ends_at: string;
    total: string | null;
    deposit: string;
    deadline: string | null;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    payments?: Payment[];
    deposit_paid?: string;
    damage_total?: string;
    amount_due?: string | null;
    credit_balance?: string | null;
    revision?: number;
    created_by?: number | null;
    creation_source?: 'guest_portal' | 'staff_portal';
    staff_editable?: boolean;
    bonfire_qty?: number;
    charcoal_qty?: number;
    liquor_qty?: number;
    partial_payment_authorized?: boolean;
    partial_payment_terms?: string | null;
};
export type Quote = {
    base: number;
    holiday_fee: number;
    extra_fee: number;
    cleaning_fee: number;
    optional_fee: number;
    total: number | null;
    deposit: number;
    security_deposit: number;
};
export type QuoteResponse = {
    quote: Quote;
    availability: "available" | "queue" | "blocked";
    queue_position: number | null;
};
export type SettingsResponse = {
    settings: Settings;
    payment_methods: PaymentMethod[];
};
export type InquirySource = string;
export type ReservationType = "Overnight Stay" | "Day Tour";
