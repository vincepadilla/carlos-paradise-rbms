export type ReservationReportFilters = {
    search: string;
    date_range: "all" | "this_month" | "last_month" | "this_year" | "custom";
    status: string;
    start_date: string;
    end_date: string;
};

export type ReservationReportRow = {
    id: number;
    booking_reference: string;
    guest_name: string;
    check_in_date: string;
    check_out_date: string;
    guest_count: number;
    adults: number;
    children: number;
    status: string;
    payment: {
        state: string;
        submitted_amount: string;
        verified_amount: string;
        required_amount: string | null;
    };
    pricing: {
        base_amount: string | null;
        discount_amount: string | null;
        discount_type: string | null;
        discount_confirmed_none: boolean;
        final_amount: string | null;
    };
    requested_at: string;
};

export type ReservationReportResponse = {
    data: ReservationReportRow[];
    current_page: number;
    last_page: number;
    per_page: number;
    from: number | null;
    to: number | null;
    total: number;
    filters: {
        applied: ReservationReportFilters & { date_label: string };
        statuses: string[];
        date_ranges: string[];
    };
    generated_at: string;
};

export type ReservationReportPrintResponse = Pick<ReservationReportResponse, "data" | "total" | "filters" | "generated_at">;

export type PaymentReportFilters = {
    search: string;
    date_range: ReservationReportFilters["date_range"];
    payment_status: string;
    start_date: string;
    end_date: string;
};

export type PaymentReportRow = {
    id: number;
    booking_reference: string;
    check_in_date: string;
    check_out_date: string;
    guest_count: number;
    adults: number;
    children: number;
    payment_status: "unpaid" | "awaiting_review" | "partially_verified" | "verified" | "rejected";
    submitted_amount: string;
    verified_amount: string;
    required_amount: string | null;
    methods: string[];
    requested_at: string;
};

export type PaymentReportResponse = {
    data: PaymentReportRow[];
    current_page: number;
    last_page: number;
    per_page: number;
    from: number | null;
    to: number | null;
    total: number;
    filters: {
        applied: PaymentReportFilters & { date_label: string };
        statuses: string[];
        date_ranges: string[];
    };
    generated_at: string;
};

export type PaymentReportPrintResponse = Pick<PaymentReportResponse, "data" | "total" | "filters" | "generated_at">;
