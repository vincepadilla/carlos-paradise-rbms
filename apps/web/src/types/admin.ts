import type { SavedReservation } from "./reservation";

export type AdminReservation = SavedReservation & {
    user_id: number;
    adults: number;
    children: number;
    pets: number;
    notes: string | null;
    google_sync?: import('./calendar').GoogleSync;
    opportunity: { id: number; status: string } | null;
    extension_status: string | null;
    extension_reason: string | null;
    extension_message: string | null;
    extension_date: string | null;
    completed_at?: string | null;
    extension_access?: { enabled: boolean | number; agreed_deadline: string; granted_at: string; revoked_at: string | null; consumed_at: string | null } | null;
};

export type AdminGuest = {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    latest_booking_reference: string | null;
    is_active: boolean;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
};

export type AdminGuestUpdate = {
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
    is_active: boolean;
};

export type AdminGuestReservation = {
    id: number;
    booking_reference: string;
    status: string;
    contact_address: string | null;
    requested_at: string;
    starts_at: string;
    ends_at: string;
    adults: number;
    children: number;
    required_deposit: string;
    payment_status: string;
    payment_amount: string;
    payment_amount_kind: "verified" | "submitted" | "rejected" | null;
};

export type AdminGuestDetails = {
    guest: AdminGuest;
    reservation: AdminGuestReservation | null;
    reservations: AdminGuestReservation[];
    payments: Array<{
        id: number;
        reservation_id: number;
        booking_reference: string;
        amount: string;
        status: string;
        payment_kind: string;
        reference: string;
        payment_date: string | null;
        submitted_at: string;
        method: string;
    }>;
    activity: Array<{
        id: string;
        kind: 'account' | 'reservation';
        event: string;
        from_status: string | null;
        to_status: string | null;
        reason: string | null;
        occurred_at: string;
        reservation_id: number | null;
        booking_reference: string | null;
        actor_name: string | null;
    }>;
};

export type AvailabilityBlock = {
    id: number;
    starts_on: string;
    ends_on: string;
    reason: string;
    google_sync?: import('./calendar').GoogleSync;
};

export type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    total: number;
};

export type AdminNotification = {
    id: number;
    type: string;
    title: string;
    description: string;
    reservation_id: number | null;
    destination: string;
    occurred_at: string;
    read_at: string | null;
};

export type EmailRecipient = {
    reservation_id: number;
    recipient_user_id: number;
    name: string;
    email: string;
    reservation_reference: string;
    check_in_date: string;
    starts_at: string;
};

export type EmailCategory = { key: string; label: string; subject: string; message: string };
export type EmailDocument = { key: string; label: string };

export type OutgoingEmail = {
    id: number;
    recipient_name: string;
    recipient_email: string;
    reservation_id: number;
    reservation_reference: string;
    category: string;
    category_label: string;
    subject: string;
    status: 'scheduled' | 'queued' | 'sent' | 'failed';
    scheduled_for: string | null;
    queued_at: string | null;
    sent_at: string | null;
    failed_at: string | null;
    created_at: string;
    message?: string;
    sender_name?: string;
    sender_email?: string;
    attachments?: EmailDocument[];
    failure_message?: string | null;
};

export type ComposeEmailOptions = { categories: EmailCategory[]; documents: EmailDocument[] };

export type AdminReservationList = Paginated<AdminReservation> & {
    filters: {
        statuses: string[];
        types: string[];
    };
};

export type DashboardSummary = {
    total_reservations: number;
    total_guests: number;
    payments_to_review: number;
    waiting_requests: number;
    reservation_statuses: Array<{ key: string; count: number; percentage: number }>;
    reservations_per_month: Array<{ month: string; count: number }>;
    status_period_label: string;
    monthly_period_label: string;
    ongoing_reservation: AdminReservation | null;
    upcoming_movement: { reservation: AdminReservation; at: string; kind: 'Check-in' | 'Check-out' } | null;
    generated_at: string;
};

export type ReservationCreationGuest = { id: number; name: string; email: string; phone: string | null; new?: boolean };
export type ReservationCreationOptions = {
    creator: { id: number; name: string; role: 'admin' | 'owner' };
    inquiry_sources: string[];
    stay_options: Array<{ value: 'overnight' | 'day_tour'; label: string; checkin_time: string; checkout_time: string }>;
    rates: { weekday: number; friday_saturday: number; sunday: number; special: number; day_tour: number; holiday_surcharge: number; bonfire: number; charcoal: number; liquor: number; deposit: number; security_deposit: number };
    limits: { max_guests: number; min_lead_days: number };
    timezone: 'Asia/Manila';
};
export type ReservationCreationPreview = {
    guest: ReservationCreationGuest;
    creator: ReservationCreationOptions['creator'];
    quote: { base: number; holiday_fee: number; extra_fee: number; cleaning_fee: number; optional_fee: number; bonfire: number; charcoal: number; liquor: number; other: number; total: number; deposit: number; security_deposit: number };
    availability: 'available' | 'queue' | 'blocked';
    queue_position: number | null;
};
