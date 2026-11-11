export type User = {
    id: number;
    name: string;
    email: string;
    contact: string | null;
    role: "guest" | "admin" | "owner";
    active: boolean;
};
export type Payment = {
    id: number;
    amount: string;
    method: string;
    reference: string;
    status: string;
    review_note: string | null;
};
export type Reservation = {
    id: number;
    reference: string;
    user_id: number;
    user?: User;
    type: "overnight" | "day_tour";
    starts_at: string;
    ends_at: string;
    adults: number;
    children: number;
    pets: number;
    bonfire_qty: number;
    charcoal_qty: number;
    notes: string | null;
    status: string;
    total: string | null;
    deposit: string;
    deadline: string | null;
    payments?: Payment[];
    extension_date: string | null;
    extension_reason: string | null;
    extension_status: string | null;
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
export type Notice = {
    id: number;
    title: string;
    message: string;
    read_at: string | null;
};
export type Block = { id: number; date: string; reason: string };
export type Settings = {
    check_in_time?: string;
    check_out_time?: string;
    reservation_instructions?: string;
    payment_deadline_instructions?: string;
    policies?: string;
    name: string;
    contact: string;
    payment_instructions: string;
    weekday_rate: number;
    friday_saturday_rate: number;
    sunday_rate: number;
    special_rate: number;
    holiday_surcharge: number;
    standard_guests: number;
    max_guests: number;
    extra_guest_fee: number;
    cleaning_fee: number;
    cleaning_threshold: number;
    bonfire_price: number;
    charcoal_price: number;
    deposit: number;
    security_deposit: number;
    opportunity_hours: number;
    min_lead_days: number;
    special_dates: string[];
    holiday_dates: string[];
};
let csrf = "";
export class ApiError extends Error {
    status: number;

    constructor(
        message: string,
        status: number,
    ) {
        super(message);
        this.status = status;
    }
}
async function response<T>(r: Response): Promise<T> {
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
        throw new ApiError(
            data.errors
                ? Object.values(data.errors as Record<string, string[]>)
                    .flat()
                    .join(" ")
                : data.message || "The request failed.",
            r.status,
        );
    return data as T;
}
export async function initCsrf() {
    const data = await response<{ token: string }>(
        await fetch("/api/csrf", {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        }),
    );
    csrf = data.token;
}
export async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
    retryCsrf = true,
): Promise<T> {
    if (method !== "GET" && !csrf) await initCsrf();
    const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
    };
    if (method !== "GET") headers["X-CSRF-TOKEN"] = csrf;
    if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
    const r = await fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body:
            body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 419 && retryCsrf) {
        await initCsrf();
        return api<T>(path, method, body, false);
    }
    if (r.status === 419) {
        csrf = "";
        throw new ApiError(
            "Your session expired. Refresh the page and try again.",
            419,
        );
    }
    return response<T>(r);
}
export const money = (v: string | number | null) =>
    v === null
        ? "Pending agreement"
        : new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
        }).format(Number(v));
export const dateTime = (v: string) =>
    new Date(v).toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
    });
export const statusLabel = (s: string) =>
    ({
        pending: "Pending Review",
        queued: "Awaiting Opportunity",
        awaiting_deposit: "Awaiting Deposit",
        payment_review: "Payment Review",
        confirmed: "Confirmed",
        completed: "Completed",
        cancelled: "Cancelled",
        expired: "Expired",
    })[s] || s;
