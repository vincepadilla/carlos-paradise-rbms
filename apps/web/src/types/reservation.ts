import type { Settings } from "../api";

export type PaymentMethod = {
    id: number;
    name: string;
    account_name: string;
    account_number: string;
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
};
export type SavedReservation = {
    id: number;
    reference: string;
    status: string;
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
};
export type SettingsResponse = {
    settings: Settings;
    payment_methods: PaymentMethod[];
};
export type InquirySource = string;
export type ReservationType = "Overnight Stay" | "Day Tour";
