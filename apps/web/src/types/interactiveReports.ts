export type ReportKind = 'reservation' | 'guest' | 'payment' | 'queue' | 'ocular';

export type ChartDatum = { key: string; label: string; value: number; unit?: string };
export type ReportCardDatum = {
    key: string;
    label: string;
    value: number;
    format?: 'currency' | 'number';
    filter_field: 'status' | 'guest_type' | 'frequency' | 'category';
    filter_value: string;
};

export type ReportKpis = {
    scope_label: string;
    total_reservations: number;
    confirmed_reservations: number;
    verified_payments: string;
    pending_deposit_reviews: number;
};

export type DashboardReport = {
    data: Array<Record<string, unknown>>;
    current_page?: number;
    last_page?: number;
    from?: number | null;
    to?: number | null;
    total: number;
    generated_at: string;
    filters: {
        applied: {
            search: string;
            date_range: string;
            status?: string;
            payment_status?: string;
            start_date: string | null;
            end_date: string | null;
            date_label: string;
            period?: string;
            guest_type?: string;
            frequency?: string;
            category?: string;
        };
        statuses: string[];
    };
    analytics: {
        scope_label: string;
        status?: ChartDatum[];
        trend?: ChartDatum[];
        availability?: ChartDatum[];
        availability_period?: { start: string; end: string };
        classification?: ChartDatum[];
        frequency?: ChartDatum[];
        distribution?: ChartDatum[];
        cards?: ReportCardDatum[];
    };
    kpis: ReportKpis;
};
