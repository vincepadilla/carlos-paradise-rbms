import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router";
import { money, statusLabel } from "../../api";
import { useAdminSession } from "../../components/auth/RequireAdmin";
import StatusBadge from "../../components/admin/StatusBadge";
import { Icon, type IconName } from "../../components/reservations/ReservationUI";
import { AdminApi } from "../../services/AdminApi";
import { ReservationApiError } from "../../services/ReservationApi";
import type { AdminGuestDetails, AdminGuestReservation } from "../../types/admin";

type DetailState =
    | { status: "loading" }
    | { status: "success"; data: AdminGuestDetails }
    | { status: "error"; id: string; message: string };

type GuestEditForm = {
    name: string;
    email: string;
    phone: string;
    address: string;
    accountStatus: "active" | "inactive";
};

type GuestEditErrors = Partial<Record<keyof GuestEditForm, string>>;

function initials(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return (words.length ? [words[0], words.at(-1)] : ["G"])
        .map(word => Array.from(word ?? "")[0] ?? "")
        .join("")
        .toUpperCase();
}

const stayDate = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
});

function stayDates(reservation: AdminGuestReservation) {
    return `${stayDate.format(new Date(reservation.starts_at))} – ${stayDate.format(new Date(reservation.ends_at))}`;
}

function guestCount(reservation: AdminGuestReservation) {
    const count = reservation.adults + reservation.children;
    return `${count} ${count === 1 ? "guest" : "guests"}`;
}

function ReservationHistory({ reservations }: { reservations: AdminGuestReservation[] }) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const reservation = reservations.find(item => item.id === selectedId) ?? reservations[0] ?? null;

    return <article className="admin-reservation-history-card">
        <header className="admin-reservation-history-header">
            <div className="admin-reservation-history-copy">
                <h2>Reservation History</h2>
                <p>Reservation and payment information.</p>
                {reservation && reservations.length > 1 && <label className="admin-reservation-history-select">
                    <span className="sr-only">Displayed reservation</span>
                    <select value={reservation.id} onChange={event => setSelectedId(Number(event.target.value))}>
                        {reservations.map((item, index) => <option key={item.id} value={item.id}>
                            {item.booking_reference}{index === 0 ? " · Current / most recent" : ""}
                        </option>)}
                    </select>
                </label>}
            </div>
            {reservation && <StatusBadge status={reservation.status} />}
        </header>
        {reservation ? <div className="admin-reservation-history-fields">
            <dl>
                <div><dt>Reservation ID</dt><dd>{reservation.booking_reference}</dd></div>
                <div><dt>Guest Count</dt><dd>{guestCount(reservation)}</dd></div>
            </dl>
            <dl>
                <div><dt>Stay Dates</dt><dd>{stayDates(reservation)}</dd></div>
                <div><dt>Deposit / Payment Status</dt><dd>
                    {reservation.payment_status} · {money(reservation.payment_amount)}
                    {reservation.payment_amount_kind && <small>{reservation.payment_amount_kind} amount</small>}
                    <small>Required deposit: {money(reservation.required_deposit)}</small>
                </dd></div>
            </dl>
        </div> : <div className="admin-reservation-history-empty">
            <strong>No reservations yet</strong>
            <p>This guest does not have any reservation or payment history.</p>
        </div>}
    </article>;
}

const guestActions: Array<{ path: string; title: string; description: string; icon: IconName }> = [
    { path: "reservations", title: "View Reservations", description: "Current and previous reservations", icon: "calendar" },
    { path: "payments", title: "View Payment History", description: "Deposit and payment records", icon: "credit" },
    { path: "activity", title: "View Activity", description: "Account and reservation activity", icon: "clock" },
];

export default function AdminGuestDetailsPage() {
    const { id = "" } = useParams();
    const location = useLocation();
    const { revalidate } = useAdminSession();
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<DetailState>({ status: "loading" });
    const [editForm, setEditForm] = useState<GuestEditForm | null>(null);
    const [editErrors, setEditErrors] = useState<GuestEditErrors>({});
    const [saveError, setSaveError] = useState("");
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const listSearch = (location.state as { guestListSearch?: string } | null)?.guestListSearch ?? "";
    const validId = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

    useEffect(() => {
        if (!validId) return;
        const controller = new AbortController();
        void AdminApi.guest(id, controller.signal).then(data => {
            if (!controller.signal.aborted) setState({ status: "success", data });
        }).catch((cause: unknown) => {
            if (controller.signal.aborted) return;
            if (cause instanceof ReservationApiError && (cause.status === 401 || cause.status === 403)) {
                revalidate();
                return;
            }
            setState({
                status: "error",
                id,
                message: cause instanceof ReservationApiError && cause.status === 404
                    ? "Guest not found. This guest may have been removed or no longer has a guest account."
                    : cause instanceof Error ? cause.message : "Unable to load this guest.",
            });
        });
        return () => controller.abort();
    }, [attempt, id, revalidate, validId]);

    const currentState: DetailState = !validId
        ? { status: "error", id, message: "This guest is unavailable." }
        : state.status === "success" && String(state.data.guest.id) !== id
            ? { status: "loading" }
            : state.status === "error" && state.id !== id ? { status: "loading" } : state;
    const data = currentState.status === "success" ? currentState.data : null;
    const reservationStatus = data?.reservation?.status ?? null;
    const editing = editForm !== null;

    function startEditing() {
        if (!data) return;
        setEditForm({
            name: data.guest.name ?? "",
            email: data.guest.email ?? "",
            phone: data.guest.phone ?? "",
            address: data.guest.address ?? data.reservation?.contact_address ?? "",
            accountStatus: data.guest.is_active ? "active" : "inactive",
        });
        setEditErrors({});
        setSaveError("");
    }

    function cancelEditing() {
        if (saving) return;
        setEditForm(null);
        setEditErrors({});
        setSaveError("");
    }

    function updateField(field: keyof GuestEditForm, value: string) {
        setEditForm(current => current ? { ...current, [field]: value } : current);
        setEditErrors(current => ({ ...current, [field]: undefined }));
        setSaveError("");
    }

    async function saveGuest(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!data || !editForm || savingRef.current) return;

        const localErrors: GuestEditErrors = {};
        if (!editForm.name.trim()) localErrors.name = "Full name is required.";
        if (!editForm.email.trim()) localErrors.email = "Email address is required.";
        if (Object.keys(localErrors).length) {
            setEditErrors(localErrors);
            return;
        }

        savingRef.current = true;
        setSaving(true);
        setEditErrors({});
        setSaveError("");
        try {
            const updated = await AdminApi.updateGuest(data.guest.id, {
                name: editForm.name.trim(),
                email: editForm.email.trim(),
                phone: editForm.phone.trim() || null,
                address: editForm.address.trim() || null,
                is_active: editForm.accountStatus === "active",
            });
            setState({ status: "success", data: updated });
            setEditForm(null);
        } catch (cause) {
            if (cause instanceof ReservationApiError && (cause.status === 401 || cause.status === 403)) {
                revalidate();
            }
            if (cause instanceof ReservationApiError && cause.status === 422 && cause.errors) {
                const fields: GuestEditErrors = {};
                const fieldMap: Record<string, keyof GuestEditForm> = {
                    name: "name", email: "email", phone: "phone", address: "address", is_active: "accountStatus",
                };
                Object.entries(cause.errors).forEach(([key, messages]) => {
                    const field = fieldMap[key];
                    if (field && messages[0]) fields[field] = messages[0];
                });
                setEditErrors(fields);
            }
            setSaveError(cause instanceof Error ? cause.message : "Unable to save guest changes.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    return <section className="admin-guest-details-page" aria-labelledby="guest-details-title">
        <Link to={`/admin/guests${listSearch}`} className="admin-guest-back">← Back to Guests</Link>
        <header className="admin-guest-details-heading">
            <div>
                <h1 id="guest-details-title">Guest Details</h1>
                <p>Complete profile, reservation, payment, and activity information.</p>
            </div>
            {data && (editing
                ? <div className="admin-guest-edit-actions">
                    <button type="submit" form="guest-edit-form" className="admin-edit-guest" disabled={saving}>
                        {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button type="button" className="admin-edit-cancel" onClick={cancelEditing} disabled={saving}>Cancel</button>
                </div>
                : <button type="button" className="admin-edit-guest" onClick={startEditing}>Edit Guest</button>)}
        </header>

        {currentState.status === "loading" && <div className="admin-guest-state" role="status">Loading guest details…</div>}
        {currentState.status === "error" && <div className="admin-guest-state" role="alert">
            <p>{currentState.message}</p>
            {validId && <button type="button" className="admin-button" onClick={() => {
                setState({ status: "loading" });
                setAttempt(value => value + 1);
            }}>Try again</button>}
        </div>}
        {data && <><article className="admin-guest-profile-card">
            <header className="admin-guest-profile-header">
                <div className="admin-guest-identity">
                    <span className="admin-guest-avatar" aria-hidden="true">{initials(data.guest.name)}</span>
                    <div>
                        <h2>{data.guest.name || "—"}</h2>
                        <p>{data.guest.email || "—"}</p>
                        <p>{data.guest.phone || "—"}</p>
                    </div>
                </div>
                {reservationStatus
                    ? <StatusBadge status={reservationStatus} />
                    : <span className="badge badge-neutral">No Reservation</span>}
            </header>
            {editForm ? <form id="guest-edit-form" className="admin-guest-edit-form" onSubmit={saveGuest} noValidate>
                <div className="admin-guest-edit-column">
                    <label className="admin-guest-edit-field">
                        <span>Full Name</span>
                        <input name="name" autoComplete="name" value={editForm.name}
                            onChange={event => updateField("name", event.target.value)}
                            aria-invalid={Boolean(editErrors.name)} aria-describedby={editErrors.name ? "guest-name-error" : undefined} />
                        {editErrors.name && <small id="guest-name-error" role="alert">{editErrors.name}</small>}
                    </label>
                    <label className="admin-guest-edit-field">
                        <span>Email Address</span>
                        <input name="email" type="email" autoComplete="email" value={editForm.email}
                            onChange={event => updateField("email", event.target.value)}
                            aria-invalid={Boolean(editErrors.email)} aria-describedby={editErrors.email ? "guest-email-error" : undefined} />
                        {editErrors.email && <small id="guest-email-error" role="alert">{editErrors.email}</small>}
                    </label>
                    <label className="admin-guest-edit-field">
                        <span>Account Status</span>
                        <select name="account_status" value={editForm.accountStatus}
                            onChange={event => updateField("accountStatus", event.target.value)}
                            aria-invalid={Boolean(editErrors.accountStatus)}
                            aria-describedby={editErrors.accountStatus ? "guest-status-error" : undefined}>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                        {editErrors.accountStatus && <small id="guest-status-error" role="alert">{editErrors.accountStatus}</small>}
                    </label>
                </div>
                <div className="admin-guest-edit-column">
                    <label className="admin-guest-edit-field">
                        <span>Contact Number</span>
                        <input name="phone" type="tel" autoComplete="tel" value={editForm.phone}
                            onChange={event => updateField("phone", event.target.value)}
                            aria-invalid={Boolean(editErrors.phone)} aria-describedby={editErrors.phone ? "guest-phone-error" : undefined} />
                        {editErrors.phone && <small id="guest-phone-error" role="alert">{editErrors.phone}</small>}
                    </label>
                    <label className="admin-guest-edit-field">
                        <span>Address</span>
                        <input name="address" autoComplete="street-address" value={editForm.address}
                            onChange={event => updateField("address", event.target.value)}
                            aria-invalid={Boolean(editErrors.address)} aria-describedby={editErrors.address ? "guest-address-error" : undefined} />
                        {editErrors.address && <small id="guest-address-error" role="alert">{editErrors.address}</small>}
                    </label>
                </div>
                {saveError && <p className="admin-guest-save-error" role="alert">{saveError}</p>}
            </form> : <div className="admin-guest-profile-fields" id="guest-profile-fields">
                <dl>
                    <div><dt>Full Name</dt><dd>{data.guest.name || "—"}</dd></div>
                    <div><dt>Email Address</dt><dd>{data.guest.email || "—"}</dd></div>
                    <div><dt>Account Status</dt><dd>{data.guest.is_active ? "Active" : "Inactive"}</dd></div>
                </dl>
                <dl>
                    <div><dt>Contact Number</dt><dd>{data.guest.phone || "—"}</dd></div>
                    <div><dt>Address</dt><dd>{data.guest.address || data.reservation?.contact_address || "—"}</dd></div>
                    <div><dt>Reservation Status</dt><dd>{reservationStatus ? statusLabel(reservationStatus) : "No Reservation"}</dd></div>
                </dl>
            </div>}
        </article>
            <ReservationHistory reservations={data.reservations ?? (data.reservation ? [data.reservation] : [])} />
            <nav className="admin-guest-action-cards" aria-label="Guest history views">
                {guestActions.map(action => <Link key={action.path} to={`/admin/guests/${data.guest.id}/${action.path}`}
                    state={{ guestListSearch: listSearch }} className="admin-guest-action-card">
                    <Icon name={action.icon} size={22} />
                    <strong>{action.title}</strong>
                    <span>{action.description}</span>
                </Link>)}
            </nav></>}
    </section>;
}
