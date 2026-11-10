import { useEffect, useRef, useState } from "react";
import type { User, Settings } from "../api";
import type {
    PaymentMethod,
    SavedReservation,
    QuoteResponse,
    InquirySource,
    ReservationType,
} from "../types/reservation";
import {
    reservationApi,
    ReservationApiError,
} from "../services/ReservationApi";
import ReservationHeader from "../components/GuestHeader";
import {
    Icon,
    Button,
    PageHead,
    GuestCounter,
} from "../components/reservations/ReservationUI";
import MyReservationsPage from "./MyReservationsPage";
import DashboardPage from "./DashboardPage";
import ProfilePage from "./ProfilePage";
import ReservationStatusPanel from "./PaymentPage";
import {
    isValidContactNumber,
    normalizeContactNumber,
} from "../utils/contactNumber";

export default function MakeReservationPage({
    user: initialUser,
    settings,
    paymentMethods,
    onUserUpdated,
    initialPage = "reservation",
}: {
    user: User;
    onUserUpdated?: (user: User) => void;
    settings: Settings;
    paymentMethods: PaymentMethod[];
    initialPage?: "reservation" | "dashboard";
}) {
    const [user, setUser] = useState(initialUser);
    const [profileOpen, setProfileOpen] = useState(false);
    useEffect(() => setUser(initialUser), [initialUser]);
    const [step, setStep] = useState(1);
    const [showList, setShowList] = useState(false);
    const [focusReservationId, setFocusReservationId] = useState<number | null>(
        null,
    );
    const [dashboardOpen, setDashboardOpen] = useState(
        initialPage === "dashboard",
    );
    const [rows, setRows] = useState<(SavedReservation & { user_id: number })[]>(
        [],
    );
    const [name, setName] = useState(user.name);
    const [contact, setContact] = useState(() => normalizeContactNumber(
        user.contact ||
        (
            user as User & {
                phone?: string;
            }
        ).phone ||
        "",
    ));
    const [email, setEmail] = useState(user.email);
    const [inquirySource, setInquirySource] = useState<InquirySource>("");
    const [reservationType, setReservationType] =
        useState<ReservationType>("Overnight Stay");
    const [checkin, setCheckin] = useState("");
    const [checkout, setCheckout] = useState("");
    const [checkinTime, setCheckinTime] = useState("14:00");
    const [checkoutTime, setCheckoutTime] = useState("11:00");
    const [adults, setAdults] = useState(settings.standard_guests);
    const [children8, setChildren8] = useState(0);
    const [pets, setPets] = useState(0);
    const [bonfireQty, setBonfireQty] = useState(0);
    const [charcoalQty, setCharcoalQty] = useState(0);
    const [liquor, setLiquor] = useState(false);
    const [liquorNote, setLiquorNote] = useState("");
    const [special, setSpecial] = useState("");
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState("");
    const [waitAcknowledged, setWaitAcknowledged] = useState(false);
    const [saved, setSaved] = useState<SavedReservation | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
    const [serverResult, setServerResult] = useState<
        (QuoteResponse & { fingerprint: string }) | null
    >(null);
    const todayString = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    const today = new Date(`${todayString}T12:00:00`);
    const earliest = new Date(today);
    earliest.setDate(earliest.getDate() + settings.min_lead_days);
    const inputDate = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const parseDate = (value: string) => new Date(`${value}T12:00:00`);
    const checkinDate = checkin ? parseDate(checkin) : null;
    const checkoutDate = checkout ? parseDate(checkout) : null;
    const earliestCheckout = checkinDate ? new Date(checkinDate) : null;
    if (earliestCheckout)
        earliestCheckout.setDate(earliestCheckout.getDate() + 1);
    const nights =
        checkin && checkout
            ? Math.max(
                0,
                Math.round(
                    (Date.parse(`${checkout}T12:00:00Z`) -
                        Date.parse(`${checkin}T12:00:00Z`)) /
                    86400000,
                ),
            )
            : 0;
    const durationLabel =
        reservationType === "Day Tour"
            ? checkin
                ? `Day Tour · ${checkinTime}–${checkoutTime}`
                : "Select date and times"
            : nights
                ? `${nights + 1} days and ${nights} ${nights === 1 ? "night" : "nights"}`
                : "Select dates";
    const prettyDate = (date: Date | null) =>
        date
            ? date.toLocaleDateString("en-PH", {
                month: "long",
                day: "numeric",
                year: "numeric",
            })
            : "Select a date";
    const shortDate = (date: Date | null) =>
        date
            ? date.toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
                year: "numeric",
            })
            : "—";
    const money = (value: number) => `₱${value.toLocaleString("en-PH")}`;
    const chargeableGuests = adults + children8;
    const extraGuests = Math.max(0, chargeableGuests - settings.standard_guests);
    let extraFee = extraGuests * settings.extra_guest_fee;
    let cleaningFee =
        chargeableGuests >= settings.cleaning_threshold ? settings.cleaning_fee : 0;
    let baseRate = 0;
    let holidayFee = 0;
    if (
        reservationType === "Overnight Stay" &&
        checkinDate &&
        checkoutDate &&
        nights <= 30
    ) {
        for (
            const day = new Date(checkinDate);
            day < checkoutDate;
            day.setDate(day.getDate() + 1)
        ) {
            const date = inputDate(day);
            const weekday = day.getDay();
            baseRate += settings.special_dates.includes(date.slice(5))
                ? settings.special_rate
                : weekday === 0
                    ? settings.sunday_rate
                    : weekday === 5 || weekday === 6
                        ? settings.friday_saturday_rate
                        : settings.weekday_rate;
            if (settings.holiday_dates.includes(date))
                holidayFee += settings.holiday_surcharge;
        }
    }
    let optionalFees =
        bonfireQty * settings.bonfire_price + charcoalQty * settings.charcoal_price;
    let total = baseRate + holidayFee + extraFee + cleaningFee + optionalFees;
    const payload = {
        type: reservationType === "Day Tour" ? "day_tour" : "overnight",
        checkin,
        checkout,
        checkin_time: checkinTime,
        checkout_time: checkoutTime,
        adults,
        children: children8,
        pets,
        bonfire_qty: bonfireQty,
        charcoal_qty: charcoalQty,
        inquiry_source: inquirySource,
        notes: [
            special.trim(),
            liquor ? `Liquor inquiry: ${liquorNote.trim() || "Requested"}` : "",
        ]
            .filter(Boolean)
            .join("\n"),
        contact_name: name.trim(),
        contact_email: email.trim(),
        contact_phone: contact.trim(),
    };
    const fingerprint = JSON.stringify(payload);
    const checked =
        serverResult?.fingerprint === fingerprint ? serverResult : null;
    if (checked) {
        baseRate = checked.quote.base;
        holidayFee = checked.quote.holiday_fee;
        extraFee = checked.quote.extra_fee;
        cleaningFee = checked.quote.cleaning_fee;
        optionalFees = checked.quote.optional_fee;
        total = checked.quote.total ?? 0;
    }
    const remaining = Math.max(0, total - settings.deposit);
    const availability =
        checked?.availability === "blocked"
            ? "unavailable"
            : checked?.availability || "unchecked";
    const blockedConflict = availability === "unavailable";
    const handleError = (cause: unknown) => {
        if (cause instanceof ReservationApiError && cause.status === 401)
            setError(
                "Your login expired. Sign in again, then retry your reservation.",
            );
        else
            setError(
                cause instanceof Error
                    ? cause.message
                    : "Unable to save your request. Please try again.",
            );
    };
    async function fetchQuote() {
        if (payload.notes.length > 2000)
            throw new Error(
                "Special requests and liquor inquiry must total 2,000 characters or fewer.",
            );
        const data = await reservationApi<QuoteResponse>("/quote", "POST", payload);
        setServerResult({ ...data, fingerprint });
        return data;
    }
    async function next() {
        if (busyRef.current) return;
        setError("");
        if (step === 1) {
            if (!name.trim()) return setError("Please enter your full name.");
            if (!isValidContactNumber(contact))
                return setError(
                    "Please enter an 11-digit contact number beginning with 09.",
                );
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                return setError("Please enter a valid email address.");
            if (!inquirySource)
                return setError("Please select an inquiry source.");
        }
        if (step === 2) {
            if (!checkin || checkin < inputDate(earliest))
                return setError(
                    `Check-in must be at least ${settings.min_lead_days} days from today.`,
                );
            if (!checkout || !checkinTime || !checkoutTime)
                return setError("Please complete your requested schedule.");
            if (reservationType === "Day Tour" && checkout !== checkin)
                return setError(
                    "Day Tour check-in and check-out must be on the same date.",
                );
            if (reservationType === "Overnight Stay" && checkout <= checkin)
                return setError("Overnight check-out must be after the check-in date.");
            const start = Date.parse(`${checkin}T${checkinTime}:00+08:00`);
            const end = Date.parse(`${checkout}T${checkoutTime}:00+08:00`);
            if (
                !Number.isFinite(start) ||
                !Number.isFinite(end) ||
                end <= start ||
                end - start > 30 * 86400000
            )
                return setError(
                    "The stay must end after arrival and last no more than 30 days.",
                );
            if (chargeableGuests > settings.max_guests)
                return setError(
                    `The villa allows a maximum of ${settings.max_guests} chargeable guests.`,
                );
            if (pets > 10)
                return setError("A maximum of 10 pets can be included in one request.");
        }
        if (step >= 2) {
            busyRef.current = true;
            setBusy(true);
            try {
                const data = await fetchQuote();
                if (data.availability === "blocked") {
                    setStep(2);
                    setError(
                        "These dates are unavailable. Please choose different dates.",
                    );
                    return;
                }
                if (
                    data.availability === "queue" &&
                    (!checked || checked.availability !== "queue" || !waitAcknowledged)
                ) {
                    setStep(2);
                    setWaitAcknowledged(false);
                    setError(
                        "These dates overlap an active opportunity. Select Wait for Availability to continue, or choose different dates.",
                    );
                    return;
                }
            } catch (cause) {
                handleError(cause);
                return;
            } finally {
                busyRef.current = false;
                setBusy(false);
            }
        }
        setAgreed(false);
        setStep(Math.min(4, step + 1));
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    async function submit() {
        if (busyRef.current) return;
        if (!agreed) {
            setError("Please agree to the reservation policies before continuing.");
            return;
        }
        if (!checked || checked.availability === "blocked") {
            setError("Please return to Stay Details and check availability again.");
            return;
        }
        if (payload.notes.length > 2000) {
            setError(
                "Special requests and liquor inquiry must total 2,000 characters or fewer.",
            );
            return;
        }
        if (!requestKey.current || requestKey.current.fingerprint !== fingerprint)
            requestKey.current = { fingerprint, key: crypto.randomUUID() };
        busyRef.current = true;
        setBusy(true);
        setError("");
        try {
            const data = await reservationApi<{ reservation: SavedReservation }>(
                "/reservations",
                "POST",
                {
                    ...payload,
                    terms: true,
                    queue_acknowledged:
                        checked.availability === "queue" && waitAcknowledged,
                    expected_total: checked.quote.total,
                    request_key: requestKey.current.key,
                },
            );
            if (!data.reservation?.id)
                throw new Error("The server did not return a saved reservation.");
            setSaved(data.reservation);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (cause) {
            handleError(cause);
            // Refresh a stale price/availability result while keeping entered details.
            if (cause instanceof ReservationApiError && cause.status === 422) {
                try {
                    await fetchQuote();
                } catch {
                    /* Keep the original validation message. */
                }
                setAgreed(false);
                setStep(2);
                setWaitAcknowledged(false);
            }
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    function updateProfile(nextUser: User) {
        const previousContact =
            user.contact || (user as User & { phone?: string }).phone || "";
        // Refresh untouched defaults while preserving a custom booking contact.
        setName((current) => (current === user.name ? nextUser.name : current));
        setContact((current) =>
            current === normalizeContactNumber(previousContact)
                ? normalizeContactNumber(nextUser.contact || "")
                : current,
        );
        setEmail((current) => (current === user.email ? nextUser.email : current));
        setUser(nextUser);
        onUserUpdated?.(nextUser);
    }
    function openProfile() {
        if (busyRef.current) return;
        setProfileOpen(true);
        setDashboardOpen(false);
        setShowList(false);
        setSaved(null);
        setError("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function openDashboard() {
        setProfileOpen(false);
        if (busyRef.current) return;
        setDashboardOpen(true);
        setShowList(false);
        setSaved(null);
        setError("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function showForm() {
        setProfileOpen(false);
        if (busyRef.current) return;
        setDashboardOpen(false);
        setSaved(null);
        setShowList(false);
        setError("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function showConfirmedReservation(reservation: SavedReservation) {
        setProfileOpen(false);
        setRows((previous) => [
            { ...reservation, user_id: user.id },
            ...previous.filter((row) => row.id !== reservation.id),
        ]);
        setFocusReservationId(reservation.id);
        setSaved(null);
        setShowList(true);
        setDashboardOpen(false);
        setError("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    function openReservation(reservation: SavedReservation) {
        setProfileOpen(false);
        if (reservation.status === "confirmed") {
            showConfirmedReservation(reservation);
            return;
        }
        setSaved(reservation);
        setShowList(false);
        setDashboardOpen(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
    async function showReservations() {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError("");
        try {
            const data = await reservationApi<{
                reservations: (SavedReservation & { user_id: number })[];
            }>("/reservations");
            setRows(
                data.reservations.filter((r) => Number(r.user_id) === Number(user.id)),
            );
            setFocusReservationId(null);
            setSaved(null);
            setShowList(true);
            setDashboardOpen(false);
            setProfileOpen(false);
        } catch (cause) {
            handleError(cause);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }
    if (profileOpen) {
        return (
            <ProfilePage
                user={user}
                onUpdated={updateProfile}
                onDashboard={openDashboard}
                onReservations={() => void showReservations()}
                onMakeReservation={showForm}
            />
        );
    }
    if (dashboardOpen) {
        return (
            <DashboardPage
                onProfile={openProfile}
                user={user}
                navigationError={error}
                onMakeReservation={showForm}
                onReservations={() => void showReservations()}
                onSelect={openReservation}
            />
        );
    }
    if (showList) {
        return (
            <MyReservationsPage
                onProfile={openProfile}
                focusReservationId={focusReservationId}
                user={user}
                rows={rows}
                error={error}
                onReservations={() => void showReservations()}
                onMakeReservation={showForm}
                onDashboard={openDashboard}
                onSelect={openReservation}
            />
        );
    }
    if (saved)
        return (
            <div className="min-h-screen bg-[#f6f1e7] font-sans text-sm text-[#2d261f]">
                <ReservationHeader
                    onProfile={openProfile}
                    user={user}
                    onReservations={() => void showReservations()}
                    onMakeReservation={showForm}
                    onDashboard={openDashboard}
                    activePage="reservations"
                />
                <section className="mx-auto max-w-[1240px] px-4 py-6 md:p-[34px]">
                    <ReservationStatusPanel
                        key={saved.id}
                        initialReservation={saved}
                        paymentMethods={paymentMethods}
                        onDashboard={openDashboard}
                        onReservations={() => void showReservations()}
                        onConfirmed={showConfirmedReservation}
                    />

                    {error && (
                        <p role="alert" className="mt-4 text-[#a44b45]">
                            {error}
                        </p>
                    )}
                </section>
            </div>
        );

    return (
        <div className="min-h-screen bg-[#f6f1e7] font-sans text-sm leading-normal text-[#2d261f] [&_*]:box-border [&_svg]:shrink-0 [&_button]:cursor-pointer [&_button:disabled]:cursor-default [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#b08a52] [&_p]:leading-relaxed [&_p]:text-[#776f65]">
            <ReservationHeader
                onProfile={openProfile}
                user={user}
                onReservations={() => void showReservations()}
                onMakeReservation={showForm}
                onDashboard={openDashboard}
            />
            <div className="mx-auto max-w-[1240px] px-4 py-6 md:p-[34px] pb-8">
                <PageHead
                    eyebrow="Reservation Request"
                    title="Request the entire private villa"
                    copy="Complete the details below. We’ll review your requested dates and notify you when a reservation opportunity is available."
                />
                <div className="mb-5 grid max-w-[760px] grid-cols-4 gap-2 [&>button]:flex [&>button]:items-center [&>button]:gap-2 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button]:text-left [&>button]:text-[11px] [&>button]:text-[#a9a198] [&>button>span]:grid [&>button>span]:size-[25px] [&>button>span]:shrink-0 [&>button>span]:place-items-center [&>button>span]:rounded-full [&>button>span]:bg-[#e5e0d9] [&>button>span]:font-extrabold [&>button>b]:hidden sm:[&>button>b]:block sm:[&>button:not(:last-child)]:after:mx-2 sm:[&>button:not(:last-child)]:after:h-px sm:[&>button:not(:last-child)]:after:flex-1 sm:[&>button:not(:last-child)]:after:bg-[#e3d9cb] sm:[&>button:not(:last-child)]:after:content-['']">
                    {["Guest Details", "Stay Details", "Preferences", "Review"].map(
                        (label, i) => (
                            <button
                                type="button"
                                onClick={() => i + 1 < step && setStep(i + 1)}
                                aria-current={step === i + 1 ? "step" : undefined}
                                disabled={busy || i + 1 > step}
                                className={
                                    step >= i + 1
                                        ? "text-[#4c3425]! [&>span]:bg-[#4c3425]! [&>span]:text-white!"
                                        : ""
                                }
                                key={label}
                            >
                                <span>
                                    {step > i + 1 ? <Icon name="check" size={15} /> : i + 1}
                                </span>
                                <b>{label}</b>
                            </button>
                        ),
                    )}
                </div>
                <div
                    className={`max-w-[960px] ${step < 4 ? "grid max-w-none! grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_280px]" : ""} `}
                >
                    <section className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-[22px] md:p-8 min-w-0">
                        <fieldset className="contents" disabled={busy}>
                            {error && (
                                <div
                                    role="alert"
                                    className="mb-[18px] rounded-lg border border-[#e7bbb6] bg-[#f7e6e3] px-[15px] py-[13px] text-[11px] font-bold text-[#a44b45]"
                                >
                                    {error}
                                </div>
                            )}
                            {step === 1 && (
                                <>
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px]">
                                        <Icon name="people" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Guest Information
                                            </span>
                                            <h2>Who is requesting the stay?</h2>
                                            <p>
                                                Your saved profile information has been added. You can
                                                edit it below.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 gap-x-[18px] sm:grid-cols-2">
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Full Name</span>
                                            <input
                                                required
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Enter your full name"
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Contact Number</span>
                                            <input
                                                required
                                                type="tel"
                                                value={contact}
                                                onChange={(e) =>
                                                    setContact(
                                                        normalizeContactNumber(
                                                            e.target.value,
                                                        ),
                                                    )
                                                }
                                                placeholder="09XXXXXXXXX"
                                                inputMode="numeric"
                                                pattern="09[0-9]{9}"
                                                maxLength={11}
                                                autoComplete="tel"
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Email Address</span>
                                            <input
                                                required
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="you@example.com"
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Inquiry Source</span>
                                            <select
                                                required
                                                value={inquirySource}
                                                onChange={(event) =>
                                                    setInquirySource(event.target.value as InquirySource)
                                                }
                                            >
                                                <option value="" disabled>Select</option>
                                                <option>Facebook Messenger</option>
                                                <option>TikTok</option>
                                                <option>Instagram</option>
                                                <option>WhatsApp</option>
                                                <option>Phone Call</option>
                                                <option>Other</option>
                                            </select>
                                        </label>
                                    </div>
                                </>
                            )}
                            {step === 2 && (
                                <>
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px]">
                                        <Icon name="calendar" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Stay Details
                                            </span>
                                            <h2>Choose your requested dates</h2>
                                            <p>
                                                Check-in must be at least two days from today. Multi-day
                                                stays are welcome.
                                            </p>
                                        </div>
                                    </div>
                                    <fieldset className="mb-5 grid grid-cols-1 gap-2.5 border-0 p-0 sm:grid-cols-2 [&>legend]:mb-2 [&>legend]:text-[11px] [&>legend]:font-extrabold [&>label]:flex [&>label]:min-h-[70px] [&>label]:cursor-pointer [&>label]:items-start [&>label]:gap-2.5 [&>label]:rounded-[9px] [&>label]:border [&>label]:border-[#e3d9cb] [&>label]:bg-[#fffdf8] [&>label]:p-3.5 [&_input]:mt-[3px] [&_input]:accent-[#607466] [&_span]:flex [&_span]:flex-col [&_span]:gap-1 [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65]">
                                        <legend>Reservation Request Type</legend>
                                        {(["Overnight Stay", "Day Tour"] as ReservationType[]).map(
                                            (type) => (
                                                <label
                                                    className={
                                                        reservationType === type
                                                            ? "border-[#607466]! bg-[#e8eee5]!"
                                                            : ""
                                                    }
                                                    key={type}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={reservationType === type}
                                                        onChange={() => {
                                                            setReservationType(type);
                                                            setCheckinTime(
                                                                type === "Day Tour" ? "09:00" : "14:00",
                                                            );
                                                            setCheckoutTime(
                                                                type === "Day Tour" ? "17:00" : "11:00",
                                                            );
                                                            setWaitAcknowledged(false);
                                                            setError("");
                                                            if (checkin) {
                                                                if (type === "Day Tour") {
                                                                    setCheckout(checkin);
                                                                    setCheckinTime("09:00");
                                                                    setCheckoutTime("17:00");
                                                                } else {
                                                                    const nextDay = parseDate(checkin);
                                                                    nextDay.setDate(nextDay.getDate() + 1);
                                                                    setCheckout(inputDate(nextDay));
                                                                    setCheckinTime("14:00");
                                                                    setCheckoutTime("11:00");
                                                                }
                                                            }
                                                        }}
                                                    />
                                                    <span>
                                                        <b>{type}</b>
                                                        <small>
                                                            {type === "Day Tour"
                                                                ? "Schedule and price require Admin or Owner agreement."
                                                                : "Standard overnight villa reservation."}
                                                        </small>
                                                    </span>
                                                </label>
                                            ),
                                        )}
                                    </fieldset>
                                    <div className="mb-4 grid grid-cols-1 gap-x-[18px] sm:grid-cols-2">
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Check-in Date</span>
                                            <input
                                                className={
                                                    availability === "unavailable"
                                                        ? "border-[#a44b45]! bg-[#f7e6e3]!"
                                                        : ""
                                                }
                                                type="date"
                                                min={inputDate(earliest)}
                                                value={checkin}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCheckin(value);
                                                    setWaitAcknowledged(false);
                                                    if (value) {
                                                        if (reservationType === "Day Tour") {
                                                            setCheckout(value);
                                                        } else {
                                                            const nextDay = parseDate(value);
                                                            nextDay.setDate(nextDay.getDate() + 1);
                                                            setCheckout(inputDate(nextDay));
                                                        }
                                                    } else setCheckout("");
                                                    setError("");
                                                }}
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Check-out Date</span>
                                            <input
                                                className={
                                                    availability === "unavailable"
                                                        ? "border-[#a44b45]! bg-[#f7e6e3]!"
                                                        : ""
                                                }
                                                type="date"
                                                min={
                                                    reservationType === "Day Tour" && checkin
                                                        ? checkin
                                                        : earliestCheckout
                                                            ? inputDate(earliestCheckout)
                                                            : inputDate(earliest)
                                                }
                                                value={checkout}
                                                onChange={(e) => {
                                                    setCheckout(e.target.value);
                                                    setWaitAcknowledged(false);
                                                    setError("");
                                                }}
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Check-in Time</span>
                                            <input
                                                type="time"
                                                readOnly={reservationType === "Overnight Stay"}
                                                value={checkinTime}
                                                onChange={(event) => {
                                                    setCheckinTime(event.target.value);
                                                    setWaitAcknowledged(false);
                                                    setError("");
                                                }}
                                            />
                                        </label>
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>Check-out Time</span>
                                            <input
                                                type="time"
                                                readOnly={reservationType === "Overnight Stay"}
                                                value={checkoutTime}
                                                onChange={(event) => {
                                                    setCheckoutTime(event.target.value);
                                                    setWaitAcknowledged(false);
                                                    setError("");
                                                }}
                                            />
                                        </label>
                                    </div>
                                    {availability === "queue" && (
                                        <div className="mb-4 flex items-start gap-3 rounded-[9px] border border-[#e3d9cb] bg-[#f6ecd7] p-4 [&>svg]:text-[#b08a52] [&_p]:text-[10px]">
                                            <Icon name="clock" />
                                            <div>
                                                <b>Availability Notice</b>
                                                <strong>Reservation opportunity conflict</strong>
                                                <p>
                                                    Your selected dates overlap with an existing
                                                    reservation opportunity. You would be position{" "}
                                                    {checked?.queue_position ?? "next"} in the request
                                                    queue. You may wait for the
                                                    opportunity to become available if the earlier request
                                                    is cancelled or expires. Would you like to continue
                                                    waiting?
                                                </p>
                                                <small>
                                                    Selected dates overlap an active reservation
                                                    opportunity.
                                                    <br />
                                                    Waiting does not guarantee the reservation. You cannot
                                                    submit a deposit while the existing opportunity
                                                    remains active.
                                                </small>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <Button
                                                        onClick={() => {
                                                            setWaitAcknowledged(true);
                                                            setError("");
                                                        }}
                                                    >
                                                        {waitAcknowledged
                                                            ? "Wait Selected"
                                                            : "Wait for Availability"}
                                                    </Button>
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => {
                                                            setCheckin("");
                                                            setCheckout("");
                                                            setWaitAcknowledged(false);
                                                            setError("");
                                                        }}
                                                    >
                                                        Choose Different Dates
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[9px] border border-[#e3d9cb] bg-[#f6f1e7] p-[18px] xl:grid-cols-[1fr_auto_1fr_150px] [&>div]:flex [&>div]:flex-col [&>div]:gap-[5px] [&_span]:text-[10px] [&_span]:text-[#776f65] [&_small]:font-bold [&_small]:text-[#b08a52] [&>svg]:text-[#b08a52]">
                                        <div>
                                            <span>Check-in</span>
                                            <b>{prettyDate(checkinDate)}</b>
                                            <small>{checkinTime || "Select time"}</small>
                                        </div>
                                        <Icon name="arrow" />
                                        <div>
                                            <span>Check-out</span>
                                            <b>{prettyDate(checkoutDate)}</b>
                                            <small>{checkoutTime || "Select time"}</small>
                                        </div>
                                        <div className="col-span-full flex-row! items-center border-t border-[#e3d9cb] pt-3 xl:col-span-1 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-[18px] [&>svg]:text-[#527a76] [&_span]:flex [&_span]:flex-col [&_span]:gap-1 [&_b]:text-[13px] [&_b]:text-[#2d261f]">
                                            <Icon name="clock" />
                                            <span>
                                                Duration<b>{durationLabel}</b>
                                            </span>
                                        </div>
                                    </div>
                                    {availability === "unavailable" && (
                                        <div className="mt-3.5 flex items-start gap-3 rounded-[9px] border border-[#e3d9cb] p-[15px] [&_p]:mt-1 [&_p]:mb-0 [&_p]:text-[10px] border-[#e7bbb6]! bg-[#f7e6e3]!">
                                            <span>
                                                <Icon name="clock" />
                                            </span>
                                            <div>
                                                <b>Date Unavailable</b>
                                                <p>
                                                    {blockedConflict
                                                        ? "This date is unavailable. Carlos Paradise is not accepting reservations for this date. Please choose another date."
                                                        : "These dates are currently unavailable. Please select another date range."}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    <div className="my-7 h-px bg-[#e3d9cb]" />
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px] mt-0! mb-[18px]! border-0! p-0!">
                                        <Icon name="people" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Guest Count
                                            </span>
                                            <h2>Tell us about your group</h2>
                                        </div>
                                    </div>
                                    <div className="overflow-hidden rounded-[9px] border border-[#e3d9cb]">
                                        <GuestCounter
                                            label="Number of Adults"
                                            value={adults}
                                            onChange={(value) =>
                                                setAdults(Math.min(settings.max_guests, value))
                                            }
                                        />
                                        <GuestCounter
                                            label="Number of Children (8+ years old)"
                                            value={children8}
                                            onChange={(value) =>
                                                setChildren8(Math.min(settings.max_guests, value))
                                            }
                                        />
                                        <GuestCounter
                                            label="Number of Pets"
                                            helper="Pets are welcome and must wear diapers at all times."
                                            value={pets}
                                            onChange={(value) => setPets(Math.min(10, value))}
                                        />
                                    </div>
                                    <div className="mt-[15px] rounded-lg bg-[#e8eee5] p-4 [&>div]:mb-2.5 [&>div]:flex [&>div]:justify-between [&>div]:text-[11px] [&>small]:mt-2 [&>small]:block [&>small]:text-[9px] [&>small]:text-[#776f65]">
                                        <div>
                                            <span>Chargeable guests</span>
                                            <b>{chargeableGuests}</b>
                                        </div>
                                        <small>
                                            Standard pricing covers {settings.standard_guests} guests.
                                            Additional guest charges apply above{" "}
                                            {settings.standard_guests}. The existing cleaning fee
                                            policy remains visible when applicable.
                                        </small>
                                    </div>
                                </>
                            )}
                            {step === 3 && (
                                <>
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px]">
                                        <Icon name="sparkle" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Additional Fees & Optional Services
                                            </span>
                                            <h2>Personalize your stay</h2>
                                            <p>Select only what your group needs.</p>
                                        </div>
                                    </div>
                                    <div className="mb-5 grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                                        <div
                                            className={`grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] grid-cols-[1fr_auto]! bg-[#f6f1e7] ${cleaningFee ? "border-[#607466]! bg-[#e8eee5]!" : ""} `}
                                        >
                                            <span>
                                                <b>
                                                    Cleaning Fee ({settings.cleaning_threshold}+ guests)
                                                </b>
                                                <small>
                                                    Applied automatically at {settings.cleaning_threshold}{" "}
                                                    chargeable guests.
                                                </small>
                                            </span>
                                            <strong>{money(1000)}</strong>
                                        </div>
                                        <div
                                            className={
                                                bonfireQty
                                                    ? "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] grid-cols-[1fr_auto]! border-[#607466]! bg-[#e8eee5]!"
                                                    : "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] grid-cols-[1fr_auto]!"
                                            }
                                        >
                                            <span>
                                                <b>Bonfire Wood Bundle</b>
                                                <small>
                                                    {money(settings.bonfire_price)} each · Subtotal{" "}
                                                    {money(bonfireQty * settings.bonfire_price)}
                                                </small>
                                            </span>
                                            <div className="grid shrink-0 grid-cols-[32px_38px_32px] items-center text-center [&>button]:size-8 [&>button]:rounded-full [&>button]:border [&>button]:border-[#e3d9cb] [&>button]:bg-[#fffdf8] [&>button]:text-lg [&>button]:leading-none [&>button]:text-[#4c3425] [&>button:hover]:bg-[#f6f1e7]">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setBonfireQty(Math.max(0, bonfireQty - 1))
                                                    }
                                                >
                                                    −
                                                </button>
                                                <strong>{bonfireQty}</strong>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setBonfireQty(Math.min(20, bonfireQty + 1))
                                                    }
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                        <div
                                            className={
                                                charcoalQty
                                                    ? "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] grid-cols-[1fr_auto]! border-[#607466]! bg-[#e8eee5]!"
                                                    : "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] grid-cols-[1fr_auto]!"
                                            }
                                        >
                                            <span>
                                                <b>Charcoal</b>
                                                <small>
                                                    {money(settings.charcoal_price)} each · Subtotal{" "}
                                                    {money(charcoalQty * settings.charcoal_price)}
                                                </small>
                                            </span>
                                            <div className="grid shrink-0 grid-cols-[32px_38px_32px] items-center text-center [&>button]:size-8 [&>button]:rounded-full [&>button]:border [&>button]:border-[#e3d9cb] [&>button]:bg-[#fffdf8] [&>button]:text-lg [&>button]:leading-none [&>button]:text-[#4c3425] [&>button:hover]:bg-[#f6f1e7]">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setCharcoalQty(Math.max(0, charcoalQty - 1))
                                                    }
                                                >
                                                    −
                                                </button>
                                                <strong>{charcoalQty}</strong>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setCharcoalQty(Math.min(100, charcoalQty + 1))
                                                    }
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                        <label
                                            className={
                                                liquor
                                                    ? "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466] border-[#607466]! bg-[#e8eee5]!"
                                                    : "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[9px] border border-[#e3d9cb] bg-[#fffdf8] p-3.5 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&_small]:text-[9px] [&_small]:leading-snug [&_small]:text-[#776f65] [&>strong]:text-right [&>strong]:text-[11px] [&>strong]:text-[#4c3425] [&_input]:accent-[#607466]"
                                            }
                                        >
                                            <input
                                                type="checkbox"
                                                checked={liquor}
                                                onChange={(e) => setLiquor(e.target.checked)}
                                            />
                                            <span>
                                                <b>Inquire about Liquors</b>
                                                <small>
                                                    Price upon inquiry. No amount is added to the total.
                                                </small>
                                            </span>
                                            <strong>Upon inquiry</strong>
                                        </label>
                                    </div>
                                    {liquor && (
                                        <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                            <span>
                                                Liquor inquiry <i>Optional</i>
                                            </span>
                                            <input
                                                maxLength={500}
                                                value={liquorNote}
                                                onChange={(e) => setLiquorNote(e.target.value)}
                                                placeholder="What would you like to inquire about?"
                                            />
                                        </label>
                                    )}
                                    <div className="my-7 h-px bg-[#e3d9cb]" />
                                    <label className="mb-[17px] flex flex-col gap-2 text-xs font-bold text-[#2d261f] [&>span>i]:ml-1 [&>span>i]:font-normal [&>span>i]:not-italic [&>span>i]:text-[#776f65] [&_input]:w-full [&_input]:min-h-[47px] [&_input]:rounded-lg [&_input]:border [&_input]:border-[#e3d9cb] [&_input]:bg-white [&_input]:px-[13px] [&_input]:font-medium [&_input]:text-[#2d261f] [&_input]:outline-none [&_input:focus]:border-[#b08a52] [&_input:focus]:ring-2 [&_input:focus]:ring-[#b08a52]/15 [&_select]:w-full [&_select]:min-h-[47px] [&_select]:rounded-lg [&_select]:border [&_select]:border-[#e3d9cb] [&_select]:bg-white [&_select]:px-[13px] [&_select]:font-medium [&_select]:text-[#2d261f] [&_select]:outline-none [&_select:focus]:border-[#b08a52] [&_select:focus]:ring-2 [&_select:focus]:ring-[#b08a52]/15 [&_textarea]:w-full [&_textarea]:min-h-[47px] [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-[#e3d9cb] [&_textarea]:bg-white [&_textarea]:px-[13px] [&_textarea]:font-medium [&_textarea]:text-[#2d261f] [&_textarea]:outline-none [&_textarea:focus]:border-[#b08a52] [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-[#b08a52]/15 [&_textarea]:min-h-40 [&_textarea]:resize-y [&_textarea]:pt-3.5">
                                        <span>
                                            Special Requests <i>Optional</i>
                                        </span>
                                        <textarea
                                            maxLength={2000}
                                            value={special}
                                            onChange={(e) => setSpecial(e.target.value)}
                                            placeholder="Tell us about any special requests or information you would like Carlos Paradise to know."
                                        />
                                    </label>
                                    <div className="my-7 h-px bg-[#e3d9cb]" />
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px] mt-0! mb-[18px]! border-0! p-0!">
                                        <Icon name="shield" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Reservation Policies
                                            </span>
                                            <h2>Please review before continuing</h2>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 [&>details]:overflow-hidden [&>details]:rounded-lg [&>details]:border [&>details]:border-[#e3d9cb] [&>details]:bg-[#fffdf8] [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:justify-between [&_summary]:px-4 [&_summary]:py-3.5 [&_summary]:font-bold [&_summary::-webkit-details-marker]:hidden [&_summary>svg]:size-4 [&_summary>svg]:text-[#776f65] [&_details[open]>summary]:border-b [&_details[open]>summary]:border-[#e3d9cb] [&_details[open]>summary>svg]:rotate-90 [&_details>div]:p-4 [&_p]:mt-[5px] [&_p]:mb-[15px] [&_p]:text-[11px] [&_p]:leading-relaxed">
                                        <details open>
                                            <summary>
                                                Resort policies <Icon name="chevron" />
                                            </summary>
                                            <div>
                                                <b>Check-in & Check-out</b>
                                                <p>
                                                    Requested dates and times are checked for conflicts.
                                                    Day Tour schedules require Admin or Owner agreement.
                                                </p>
                                                <b>Guest Pricing</b>
                                                <p>
                                                    Standard pricing covers {settings.standard_guests}{" "}
                                                    chargeable guests. Each additional chargeable guest is{" "}
                                                    {money(settings.extra_guest_fee)}. Existing cleaning
                                                    fee policies continue to apply.
                                                </p>
                                                <b>Pet Policy</b>
                                                <p>
                                                    The private villa is pet-friendly. Pets must wear
                                                    diapers at all times.
                                                </p>
                                                <b>Towel Policy</b>
                                                <p>
                                                    The Master’s Bedroom includes 2 towels only. Other
                                                    guests should bring their own towels.
                                                </p>
                                                <b>Parking Policy</b>
                                                <p>
                                                    Driveway: 1 van and 1 SUV. Rear parking: 5–6 vehicles.
                                                    Additional vehicles may park in front of the villa.
                                                </p>
                                            </div>
                                        </details>
                                        <details>
                                            <summary>
                                                Cancellation & refund policy <Icon name="chevron" />
                                            </summary>
                                            <div className="flex flex-col [&>span]:flex [&>span]:justify-between [&>span]:gap-3 [&>span]:border-b [&>span]:border-[#e3d9cb] [&>span]:py-2.5 [&>span]:text-[11px]">
                                                <span>
                                                    1 month before check-in <b>100% refund</b>
                                                </span>
                                                <span>
                                                    3 weeks before check-in <b>50% refund</b>
                                                </span>
                                                <span>
                                                    2 weeks or less <b>No refund</b>
                                                </span>
                                            </div>
                                        </details>
                                        <details>
                                            <summary>
                                                Rescheduling policy <Icon name="chevron" />
                                            </summary>
                                            <div>
                                                <p>
                                                    Guests may request to reschedule at least 3 weeks
                                                    before the reservation. Later requests may not be
                                                    accommodated. Changes made within 2 weeks incur a{" "}
                                                    <b>₱2,000 penalty fee</b>.
                                                </p>
                                            </div>
                                        </details>
                                        <details>
                                            <summary>
                                                Deposits & payment information <Icon name="chevron" />
                                            </summary>
                                            <div>
                                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 [&>span]:flex [&>span]:flex-col [&>span]:gap-[7px] [&>span]:rounded-[7px] [&>span]:bg-[#f6f1e7] [&>span]:p-3.5 [&_small]:leading-normal [&_small]:text-[#776f65]">
                                                    <span>
                                                        <b>
                                                            Reservation Deposit · {money(settings.deposit)}
                                                        </b>
                                                        <small>
                                                            Required only when your reservation opportunity
                                                            begins. Your date is secured after payment
                                                            verification and reservation approval.
                                                        </small>
                                                    </span>
                                                    <span>
                                                        <b>
                                                            Refundable Security Deposit ·{" "}
                                                            {money(settings.security_deposit)}
                                                        </b>
                                                        <small>
                                                            Collected during check-in and returned after
                                                            inspection if there are no damages or losses. Not
                                                            included in this estimate.
                                                        </small>
                                                    </span>
                                                </div>
                                                <p>
                                                    {settings.payment_instructions}
                                                    <br />
                                                    Verified receiving accounts will appear after staff
                                                    grant a deposit opportunity.
                                                </p>
                                            </div>
                                        </details>
                                    </div>
                                    <div className="mt-3.5 flex gap-2.5 rounded-lg bg-[#f6ecd7] p-[13px] [&>svg]:text-[#b08a52] [&>p]:m-0 [&>p]:flex [&>p]:flex-col [&>p]:gap-[3px] [&>p]:text-[10px]">
                                        <Icon name="shield" />
                                        <p>
                                            <b>Cleaning fee policy note</b>The stated policy is a fee
                                            of {money(settings.cleaning_fee)} for{" "}
                                            {settings.cleaning_threshold} or more chargeable guests.
                                        </p>
                                    </div>
                                </>
                            )}
                            {step === 4 && (
                                <>
                                    <div className="mb-[25px] flex gap-3.5 border-b border-[#e3d9cb] pb-5 [&>svg]:text-[#b08a52] [&_h2]:mb-1 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.035em] [&_p]:m-0 [&_p]:text-sm [&_span]:mb-[5px]">
                                        <Icon name="check" />
                                        <div>
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Review Reservation
                                            </span>
                                            <h2>Review your reservation request</h2>
                                            <p>
                                                Confirm your dates, guest information, selections, and
                                                estimated cost.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-[15px] border-b border-[#e3d9cb] pb-5 [&>img]:h-[82px] [&>img]:w-[120px] [&>img]:rounded-[7px] [&>img]:object-cover [&>div]:flex [&>div]:flex-col [&>div]:gap-[5px] [&_span]:text-[10px] [&_span]:text-[#776f65] [&_small]:text-[10px] [&_small]:text-[#776f65] [&_b]:text-[17px]">
                                        <img
                                            src="/assets/villa-exterior.jpg"
                                            alt="Carlos Paradise private villa"
                                        />
                                        <div>
                                            <span>Private Villa</span>
                                            <b>
                                                {shortDate(checkinDate)} – {shortDate(checkoutDate)}
                                            </b>
                                            <small>
                                                {durationLabel} ·{" "}
                                                {availability === "queue"
                                                    ? "Pending availability review"
                                                    : checked
                                                        ? "Availability checked; subject to staff review"
                                                        : "Availability will be checked before review"}
                                            </small>
                                        </div>
                                    </div>
                                    <div className="mt-4 overflow-hidden rounded-[9px] border border-[#e3d9cb] [&>section]:border-b [&>section]:border-[#e3d9cb] [&>section]:p-5 [&>section:last-child]:border-0 [&_h3]:mt-0 [&_h3]:mb-3.5 [&_h3]:text-[13px] [&_h3]:font-bold [&_h3]:text-[#4c3425] [&_section>p]:m-0 [&_section>p]:text-[11px]">
                                        <section>
                                            <h3>Stay Details</h3>
                                            <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-3 [&>span]:flex [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-[5px] [&>span]:text-[9px] [&>span]:text-[#776f65] [&_b]:break-words [&_b]:text-[11px] [&_b]:text-[#2d261f]">
                                                <span>
                                                    Check-in
                                                    <b>
                                                        {prettyDate(checkinDate)} · {checkinTime}
                                                    </b>
                                                </span>
                                                <span>
                                                    Check-out
                                                    <b>
                                                        {prettyDate(checkoutDate)} · {checkoutTime}
                                                    </b>
                                                </span>
                                                <span>
                                                    Reservation Type<b>{reservationType}</b>
                                                </span>
                                            </div>
                                        </section>
                                        <section>
                                            <h3>Guest Details</h3>
                                            <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-3 [&>span]:flex [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-[5px] [&>span]:text-[9px] [&>span]:text-[#776f65] [&_b]:break-words [&_b]:text-[11px] [&_b]:text-[#2d261f]">
                                                <span>
                                                    Full Name<b>{name}</b>
                                                </span>
                                                <span>
                                                    Contact Number<b>{contact}</b>
                                                </span>
                                                <span>
                                                    Email Address<b>{email}</b>
                                                </span>
                                                <span>
                                                    Inquiry Source<b>{inquirySource}</b>
                                                </span>
                                            </div>
                                        </section>
                                        <section>
                                            <h3>Guest Count</h3>
                                            <div className="grid grid-cols-2 gap-[15px] sm:grid-cols-3 [&>span]:flex [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-[5px] [&>span]:text-[9px] [&>span]:text-[#776f65] [&_b]:break-words [&_b]:text-[11px] [&_b]:text-[#2d261f] sm:grid-cols-4!">
                                                <span>
                                                    Adults<b>{adults}</b>
                                                </span>
                                                <span>
                                                    Children 8+<b>{children8}</b>
                                                </span>
                                                <span>
                                                    Pets<b>{pets}</b>
                                                </span>
                                                <span>
                                                    Chargeable Guests<b>{chargeableGuests}</b>
                                                </span>
                                                <span>
                                                    Extra Guests<b>{extraGuests}</b>
                                                </span>
                                            </div>
                                        </section>
                                        <section>
                                            <h3>Additional Services</h3>
                                            <div className="flex flex-col [&>span]:grid [&>span]:grid-cols-[1fr_1fr_auto] [&>span]:gap-2.5 [&>span]:border-b [&>span]:border-[#e3d9cb] [&>span]:py-[9px] [&>span]:text-[11px] [&>span:last-child]:border-0 [&_small]:text-[#776f65]">
                                                {bonfireQty > 0 ? (
                                                    <span>
                                                        Bonfire Wood Bundle
                                                        <small>
                                                            {bonfireQty} × {money(settings.bonfire_price)}
                                                        </small>
                                                        <b>{money(bonfireQty * settings.bonfire_price)}</b>
                                                    </span>
                                                ) : (
                                                    <span>
                                                        Bonfire Wood Bundle<small>Not selected</small>
                                                        <b>—</b>
                                                    </span>
                                                )}
                                                {charcoalQty > 0 ? (
                                                    <span>
                                                        Charcoal
                                                        <small>
                                                            {charcoalQty} × {money(settings.charcoal_price)}
                                                        </small>
                                                        <b>
                                                            {money(charcoalQty * settings.charcoal_price)}
                                                        </b>
                                                    </span>
                                                ) : (
                                                    <span>
                                                        Charcoal<small>Not selected</small>
                                                        <b>—</b>
                                                    </span>
                                                )}
                                                {liquor && (
                                                    <span>
                                                        Liquors
                                                        <small>{liquorNote || "Inquiry requested"}</small>
                                                        <b>Upon inquiry</b>
                                                    </span>
                                                )}
                                            </div>
                                        </section>
                                        <section>
                                            <h3>Special Requests</h3>
                                            <p>{special || "No special requests provided."}</p>
                                        </section>
                                        <section>
                                            <h3>Reservation Policies</h3>
                                            <div className="mb-[13px] grid grid-cols-1 gap-2.5 sm:grid-cols-2 [&>span]:flex [&>span]:flex-col [&>span]:gap-[5px] [&>span]:rounded-[7px] [&>span]:bg-[#f6f1e7] [&>span]:p-[11px] [&>span]:text-[9px] [&>span]:leading-normal [&>span]:text-[#776f65] [&_b]:text-[#2d261f]">
                                                <span>
                                                    <b>Requested Schedule</b>
                                                    {checkinTime} / {checkoutTime}
                                                </span>
                                                <span>
                                                    <b>Guest Pricing</b>
                                                    {settings.standard_guests} standard ·{" "}
                                                    {money(settings.extra_guest_fee)} per additional
                                                    chargeable guest
                                                </span>
                                                <span>
                                                    <b>Pet Policy</b>Pets are allowed and must wear
                                                    diapers.
                                                </span>
                                                <span>
                                                    <b>Cancellation</b>1 month: 100% · 3 weeks: 50% · 2
                                                    weeks or less: no refund
                                                </span>
                                                <span>
                                                    <b>Rescheduling</b>Request at least 3 weeks before.
                                                    Changes within 2 weeks incur ₱2,000.
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="border-0 bg-transparent p-0 text-xs font-bold text-[#4c3425] underline"
                                                onClick={() => setStep(3)}
                                            >
                                                View Full Policies
                                            </button>
                                        </section>
                                    </div>
                                    <div className="my-[18px] overflow-hidden rounded-[9px] border border-[#e3d9cb] [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:gap-3 [&>div]:border-t [&>div]:border-[#e3d9cb] [&>div]:px-5 [&>div]:py-[11px] [&_span]:flex [&_span]:flex-col [&_span]:gap-1 [&_span]:text-[#776f65] [&_small]:text-[9px]">
                                        <div className="block! border-t-0! bg-[#f6f1e7] py-[18px]! [&>span]:mb-[5px] [&>h3]:m-0 [&>h3]:text-[17px] [&>h3]:font-bold">
                                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                                Reservation Summary
                                            </span>
                                            <h3>Cost Summary</h3>
                                        </div>
                                        <div>
                                            <span>
                                                Villa Rate<small>{durationLabel}</small>
                                            </span>
                                            <b>
                                                {reservationType === "Day Tour"
                                                    ? "Pending Admin/Owner agreement"
                                                    : money(baseRate)}
                                            </b>
                                        </div>
                                        {holidayFee > 0 && (
                                            <div>
                                                <span>Public Holiday Surcharge</span>
                                                <b>{money(holidayFee)}</b>
                                            </div>
                                        )}
                                        <div>
                                            <span>
                                                Extra Guest Fee
                                                <small>
                                                    {extraGuests
                                                        ? `${extraGuests} × ${money(settings.extra_guest_fee)}`
                                                        : "No extra charge"}
                                                </small>
                                            </span>
                                            <b>{money(extraFee)}</b>
                                        </div>
                                        <div>
                                            <span>
                                                Additional Services
                                                <small>
                                                    {bonfireQty} wood bundle · {charcoalQty} charcoal
                                                </small>
                                            </span>
                                            <b>{money(optionalFees)}</b>
                                        </div>
                                        {cleaningFee > 0 && (
                                            <div>
                                                <span>
                                                    Cleaning Fee ({settings.cleaning_threshold}+ guests)
                                                </span>
                                                <b>{money(cleaningFee)}</b>
                                            </div>
                                        )}
                                        <div className="bg-[#4c3425] py-4! text-white [&>span]:text-[10px] [&>span]:uppercase [&>span]:tracking-[0.06em] [&>span]:text-[#d8c9bc]! [&>b]:text-lg md:[&>b]:text-[22px]">
                                            <span>Estimated Total</span>
                                            <b>
                                                {reservationType === "Day Tour"
                                                    ? "Pending schedule and price approval"
                                                    : money(total)}
                                            </b>
                                        </div>
                                        <div className="bg-[#f6ecd7]">
                                            <span>
                                                Reservation Deposit
                                                <small>
                                                    Required when eligible to secure the reservation
                                                </small>
                                            </span>
                                            <b>{money(settings.deposit)}</b>
                                        </div>
                                        <div>
                                            <span>
                                                Remaining Balance
                                                <small>
                                                    {reservationType === "Day Tour"
                                                        ? "Calculated after terms are approved"
                                                        : "Due upon check-in"}
                                                </small>
                                            </span>
                                            <b>
                                                {reservationType === "Day Tour"
                                                    ? "Pending agreement"
                                                    : money(remaining)}
                                            </b>
                                        </div>
                                        {liquor && (
                                            <div>
                                                <span>
                                                    Liquors<small>Not included in numerical total</small>
                                                </span>
                                                <b>Upon inquiry</b>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2.5 rounded-lg bg-[#e6efed] p-3.5 text-[#527a76] [&_p]:m-0 [&_p]:flex [&_p]:flex-col [&_p]:text-[10px] [&_p]:text-[#527a76]!">
                                        <Icon name="shield" />
                                        <p>
                                            <b>
                                                Refundable Security Deposit ·{" "}
                                                {money(settings.security_deposit)}
                                            </b>
                                            Collected during check-in and not included in the
                                            estimated total.
                                        </p>
                                    </div>
                                    <label className="my-[18px] flex items-start gap-2.5 text-[11px] leading-relaxed [&>input]:mt-[3px] [&>input]:accent-[#4c3425] [&_button]:block [&_button]:border-0 [&_button]:bg-transparent [&_button]:py-[3px] [&_button]:font-extrabold [&_button]:text-[#4c3425] [&_button]:underline">
                                        <input
                                            type="checkbox"
                                            checked={agreed}
                                            onChange={(e) => {
                                                setAgreed(e.target.checked);
                                                setError("");
                                            }}
                                        />
                                        <span>
                                            I have read and agree to the Carlos Paradise reservation,
                                            cancellation, rescheduling, guest capacity, pet, towel,
                                            parking, and payment policies.
                                            <button type="button" onClick={() => setStep(3)}>
                                                View Full Policies
                                            </button>
                                        </span>
                                    </label>
                                    <div className="flex gap-2.5 rounded-lg bg-[#f6ecd7] p-3.5 [&_svg]:text-[#b08a52] [&_b]:mb-1 [&_b]:block [&_p]:m-0 [&_p]:text-[10px]">
                                        <Icon name="clock" />
                                        <div>
                                            <b>Important</b>
                                            <p>
                                                Submitting this form does not confirm your reservation.
                                                If no earlier request is ahead, your{" "}
                                                {settings.opportunity_hours}-hour deposit opportunity
                                                starts immediately. Otherwise, your request keeps its
                                                queue position. Dates are secured only after the{" "}
                                                {money(settings.deposit)} deposit is verified.
                                            </p>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="mt-[25px] flex items-center justify-between gap-3 border-t border-[#e3d9cb] pt-5">
                                {step > 1 ? (
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            setStep(step - 1);
                                            setError("");
                                        }}
                                    >
                                        Back
                                    </Button>
                                ) : (
                                    <span />
                                )}
                                {step < 4 ? (
                                    <Button disabled={busy} onClick={() => void next()}>
                                        {busy ? "Checking availability…" : "Continue"}{" "}
                                        <Icon name="arrow" />
                                    </Button>
                                ) : (
                                    <Button
                                        disabled={busy || !agreed}
                                        onClick={() => void submit()}
                                    >
                                        {busy ? "Saving request…" : "Submit Reservation Request"}{" "}
                                        <Icon name="arrow" />
                                    </Button>
                                )}
                            </div>
                        </fieldset>
                    </section>
                    {step < 4 && (
                        <aside className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-[22px] shadow-[0_12px_35px_rgba(63,47,33,0.06)] lg:sticky lg:top-[90px] [&>h3]:m-0 [&>h3]:mb-1 [&>h3]:text-[15px] [&>h3]:font-bold [&>small]:mb-[15px] [&>small]:block [&>small]:text-[#776f65] [&>div:not(:last-child)]:flex [&>div:not(:last-child)]:justify-between [&>div:not(:last-child)]:gap-3 [&>div:not(:last-child)]:border-b [&>div:not(:last-child)]:border-[#e3d9cb] [&>div:not(:last-child)]:py-[9px] [&>div:not(:last-child)]:text-[10px]">
                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                                Live Estimate
                            </span>
                            <h3>
                                {checkinDate && checkoutDate
                                    ? `${shortDate(checkinDate)} – ${shortDate(checkoutDate)}`
                                    : "Select your requested dates"}
                            </h3>
                            <small>{durationLabel}</small>
                            <div>
                                <span>Villa Rate</span>
                                <b>
                                    {reservationType === "Day Tour"
                                        ? "Pending agreement"
                                        : money(baseRate)}
                                </b>
                            </div>
                            <div>
                                <span>Extra Guest Fee</span>
                                <b>{money(extraFee)}</b>
                            </div>
                            {holidayFee > 0 && (
                                <div>
                                    <span>Holiday Surcharge</span>
                                    <b>{money(holidayFee)}</b>
                                </div>
                            )}
                            {cleaningFee > 0 && (
                                <div>
                                    <span>Cleaning Fee</span>
                                    <b>{money(cleaningFee)}</b>
                                </div>
                            )}
                            <div>
                                <span>Bonfire Wood × {bonfireQty}</span>
                                <b>{money(bonfireQty * settings.bonfire_price)}</b>
                            </div>
                            <div>
                                <span>Charcoal × {charcoalQty}</span>
                                <b>{money(charcoalQty * settings.charcoal_price)}</b>
                            </div>
                            {liquor && (
                                <div>
                                    <span>Liquors</span>
                                    <b>Upon inquiry</b>
                                </div>
                            )}
                            <div className="mt-[7px] flex-col! rounded-[7px] border-0! bg-[#4c3425] p-[13px]! text-white [&>span]:text-[9px] [&>span]:uppercase [&>span]:tracking-[0.06em] [&>span]:text-[#d8c9bc] [&>b]:text-xl">
                                <span>Estimated Reservation Total</span>
                                <b>
                                    {reservationType === "Day Tour"
                                        ? "Pending Admin/Owner approval"
                                        : money(total)}
                                </b>
                            </div>
                            <div className="mt-3 grid gap-2 [&>span]:flex [&>span]:flex-col [&>span]:gap-[3px] [&>span]:rounded-[7px] [&>span]:bg-[#f6f1e7] [&>span]:p-[11px] [&_small]:text-[8px] [&_small]:text-[#776f65] [&_b]:text-base [&_b]:text-[#4c3425] [&_em]:text-[8px] [&_em]:not-italic [&_em]:text-[#527a76]">
                                <span>
                                    <small>Reservation Deposit Required</small>
                                    <b>{money(settings.deposit)}</b>
                                </span>
                                <span>
                                    <small>Refundable Security Deposit</small>
                                    <b>{money(settings.security_deposit)}</b>
                                    <em>Not included in total</em>
                                </span>
                            </div>
                        </aside>
                    )}
                </div>
            </div>
        </div>
    );
}
