import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type ReactNode,
} from "react";
import type { PaymentMethod, SavedReservation } from "../types/reservation";
import {
    reservationApi,
    ReservationApiError,
} from "../services/ReservationApi";
import { money, manilaToday } from "../utils/reservation";
import { Icon } from "../components/reservations/ReservationUI";

type Reservation = SavedReservation & {
    requested_at?: string | null;
    opportunity?: { id: number; status: string } | null;
};
type Props = {
    initialReservation: SavedReservation;
    paymentMethods: PaymentMethod[];
    onDashboard?: () => void;
    onReservations?: () => void;
    onConfirmed: (reservation: SavedReservation) => void;
};
const labels: Record<string, string> = {
    pending: "Pending Staff Review",
    queued: "Awaiting Reservation Opportunity",
    awaiting_deposit: "Awaiting Deposit",
    payment_review: "Receipt Under Review",
    confirmed: "Confirmed",
    expired: "Deposit Period Ended",
    cancelled: "Cancelled",
    rejected: "Dates Secured by Earlier Request",
    completed: "Completed",
    declined: "Declined",
    held: "Held for Review",
    reserved: "Reserved",
};
const primary =
    "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[#4c3425] bg-[#4c3425] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_22px_rgba(76,52,37,0.16)] transition hover:bg-[#6e4b35] disabled:cursor-not-allowed disabled:opacity-50";
const input =
    "min-h-[46px] w-full min-w-0 rounded-lg border border-[#e3d9cb] bg-white px-3 py-3 text-sm font-normal text-[#2d261f] outline-none focus:border-[#b08a52] focus:ring-2 focus:ring-[#b08a52]/15 read-only:bg-[#f6f1e7]";
function date(value: string) {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "long",
        day: "numeric",
        year: "numeric",
    }).format(new Date(value));
}
function time(value: string) {
    return new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(new Date(value));
}
function timestamp(value: string) {
    return `${date(value)} at ${time(value)}`;
}
function duration(reservation: Reservation) {
    if (reservation.type === "day_tour") return "Day Tour";
    const day = (value: string) =>
        new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date(value));
    const nights = Math.max(
        0,
        Math.round(
            (Date.parse(`${day(reservation.ends_at)}T00:00:00Z`) -
                Date.parse(`${day(reservation.starts_at)}T00:00:00Z`)) /
            86400000,
        ),
    );
    return `${nights + 1} ${nights + 1 === 1 ? "day" : "days"} and ${nights} ${nights === 1 ? "night" : "nights"}`;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="grid min-w-0 content-start gap-2 text-xs font-semibold text-[#2d261f]">
            <span>{label}</span>
            {children}
        </label>
    );
}
function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-5 border-b border-[#e3d9cb] py-3 text-xs">
            <span className="text-[#776f65]">{label}</span>
            <b className="text-right font-semibold">{value}</b>
        </div>
    );
}

export default function PaymentPage({
    initialReservation,
    paymentMethods,
    onDashboard,
    onReservations,
    onConfirmed,
}: Props) {
    const [reservation, setReservation] =
        useState<Reservation>(initialReservation);
    const [methods, setMethods] = useState(paymentMethods);
    const [deadlineInstructions, setDeadlineInstructions] = useState("");
    const [methodId, setMethodId] = useState(
        paymentMethods[0]?.id.toString() || "",
    );
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadError, setLoadError] = useState("");
    const [submitError, setSubmitError] = useState("");
    const [receiptName, setReceiptName] = useState("");
    const [paymentAmount, setPaymentAmount] = useState(
        () => String(Number(initialReservation.deposit) || 5000),
    );
    const requiredDeposit = Number(reservation.deposit);
    const enteredPaymentAmount = Number(paymentAmount);
    const amountBelowRequired =
        !reservation.partial_payment_authorized &&
        paymentAmount.trim() !== "" &&
        Number.isFinite(enteredPaymentAmount) &&
        enteredPaymentAmount < requiredDeposit;
    const method = methods.find((account) => String(account.id) === methodId);
    const deadline = reservation.deadline
        ? new Date(reservation.deadline).getTime()
        : null;
    const expired =
        deadline === null || !Number.isFinite(deadline) || deadline <= clock;
    const minutes =
        deadline === null ? 0 : Math.max(0, Math.ceil((deadline - clock) / 60000));
    const countdown =
        deadline === null
            ? "Not started"
            : expired
                ? "Payment period ended"
                : `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
    const payments = reservation.payments || [];
    const latestPayment = [...payments].sort((a, b) => b.id - a.id)[0];
    const approved = payments
        .filter((payment) => payment.status === "approved")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const submitted = payments.some((payment) => payment.status === "submitted");
    const canPay =
        ready &&
        reservation.status === "awaiting_deposit" &&
        reservation.opportunity?.status === "active" &&
        !expired &&
        Array.isArray(reservation.payments) &&
        approved === 0 &&
        !submitted &&
        Number(reservation.deposit) > 0;
    const confirmed = reservation.status === "confirmed";
    const review =
        !confirmed && (reservation.status === "payment_review" || submitted);
    const waiting = ["pending", "queued"].includes(reservation.status);
    const badge =
        labels[reservation.status] || reservation.status.replaceAll("_", " ");

    useEffect(() => {
        if (confirmed) onConfirmed(reservation);
    }, [confirmed, reservation, onConfirmed]);

    useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        async function load() {
            try {
                if (busyRef.current) return;
                const [data, configuration] = await Promise.all([
                    reservationApi<{ reservation: Reservation }>(
                        `/reservations/${initialReservation.id}`,
                        "GET",
                        undefined,
                        controller.signal,
                    ),
                    reservationApi<{ payment_methods: PaymentMethod[]; settings?: { payment_deadline_instructions?: string } }>(
                        "/settings",
                        "GET",
                        undefined,
                        controller.signal,
                    ),
                ]);
                if (!active || busyRef.current) return;
                if (
                    !data.reservation ||
                    Number(data.reservation.id) !== Number(initialReservation.id) ||
                    !Array.isArray(configuration.payment_methods)
                )
                    throw new Error("The reservation response is incomplete.");
                setReservation(data.reservation);
                setMethods(configuration.payment_methods);
                setDeadlineInstructions(configuration.settings?.payment_deadline_instructions ?? "");
                setMethodId((id) =>
                    configuration.payment_methods.some(
                        (account) => String(account.id) === id,
                    )
                        ? id
                        : configuration.payment_methods[0]?.id.toString() || "",
                );
                setReady(true);
                setLoadError("");
            } catch (cause) {
                if (active && !controller.signal.aborted) {
                    setReady(false);
                    setLoadError(
                        cause instanceof ReservationApiError && cause.status === 401
                            ? "Your login expired. Sign in again to manage this reservation."
                            : cause instanceof Error
                                ? cause.message
                                : "Unable to refresh this reservation.",
                    );
                }
            } finally {
                if (active) timer = setTimeout(() => void load(), 15000);
            }
        }
        void load();
        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [initialReservation.id, refreshKey]);

    async function submitReceipt(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busyRef.current) return;
        setSubmitError("");
        if (!canPay || !method) {
            setSubmitError(
                "This reservation is not currently eligible for a deposit upload. Refresh its status or contact staff.",
            );
            return;
        }
        const form = event.currentTarget;
        const data = new FormData(form);
        const amount = Number(data.get("amount"));
        if (!Number.isFinite(amount) || amount < 1 || amount > 99999999) {
            setSubmitError("Enter a valid payment amount.");
            return;
        }
        if (!reservation.partial_payment_authorized && amount < requiredDeposit) {
            setSubmitError(`Amount Paid must be at least ${money(requiredDeposit)}.`);
            return;
        }
        const receipt = data.get("receipt");
        if (!(receipt instanceof File) || !receipt.size) {
            setSubmitError("Choose your payment receipt.");
            return;
        }
        if (receipt.size > 5 * 1024 * 1024) {
            setSubmitError("The receipt must be 5 MB or smaller.");
            return;
        }
        if (
            !["image/jpeg", "image/png"].includes(receipt.type)
        ) {
            setSubmitError("Choose a JPG or PNG receipt.");
            return;
        }
        data.set("amount", amount.toFixed(2));
        data.set("method", method.name);
        busyRef.current = true;
        setBusy(true);
        try {
            const response = await reservationApi<{ reservation?: Reservation }>(
                `/reservations/${reservation.id}/payments`,
                "POST",
                data,
            );
            setReservation(
                response.reservation || { ...reservation, status: "payment_review" },
            );
            form.reset();
            setReceiptName("");
            setPaymentOpen(false);
            setReady(false);
            setRefreshKey((key) => key + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (cause) {
            setSubmitError(
                cause instanceof Error
                    ? cause.message
                    : "Unable to submit your receipt.",
            );
            // Re-fetch before allowing another upload in case the response was lost after saving.
            setReady(false);
            setRefreshKey((key) => key + 1);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    if (confirmed) return null;

    let description =
        "Your reservation details are shown below. Contact the resort if you need assistance.";
    if (review)
        description =
            "Your payment receipt has been submitted and is awaiting staff verification. Your booking is not yet confirmed.";
    else if (approved > 0 && reservation.status === "awaiting_deposit")
        description =
            "A verified payment already exists. Contact staff to check your reservation status before making another payment.";
    else if (canPay)
        description = `Your reservation opportunity is active. Complete the ${money(reservation.deposit)} deposit before the deadline.`;
    else if (waiting)
        description =
            reservation.queue_position
                ? "Your request is queue position " +
                  reservation.queue_position +
                  ". " +
                  (reservation.reservations_ahead || 0) +
                  " reservation" +
                  (reservation.reservations_ahead === 1 ? "" : "s") +
                  " are ahead for overlapping dates."
                : "Your request has been received. You will be notified when a reservation opportunity is available.";
    else if (reservation.status === "awaiting_deposit")
        description = expired
            ? "Your payment deadline has ended. Contact the resort for the next steps."
            : "Your deposit opportunity is being checked. Payment becomes available after the resort confirms its active status.";

    return (
        <div className="text-[#2d261f] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#b08a52]">
            {deadlineInstructions && <p className="mx-auto mb-5 max-w-[1100px] rounded-lg border border-[#e3d9cb] bg-[#fffdf8] p-4 text-sm">{deadlineInstructions}</p>}
            {latestPayment?.status === "rejected" && <div role="status" className="mx-auto mb-5 max-w-[1100px] rounded-lg border border-[#e7bbb6] bg-[#f7e6e3] p-4 text-xs text-[#a44b45]">
                <b>Payment proof rejected.</b> {latestPayment.review_note || "Contact the resort for the review reason."}{" "}
                {canPay ? "You can submit a new payment proof before the updated deadline. Previously submitted transfer references cannot be reused." : "Check your current reservation status and deposit deadline before resubmitting."}
            </div>}
            {loadError && (
                <div
                    role="alert"
                    className="mx-auto mb-5 max-w-[1100px] rounded-lg border border-[#e7bbb6] bg-[#f7e6e3] p-4 text-xs text-[#a44b45]"
                >
                    {loadError}{" "}
                    <button
                        type="button"
                        className="border-0 bg-transparent font-bold underline"
                        onClick={() => setRefreshKey((key) => key + 1)}
                    >
                        Try again
                    </button>
                </div>
            )}
            {paymentOpen &&
                reservation.status === "awaiting_deposit" &&
                approved === 0 &&
                !submitted ? (
                <section className="mx-auto max-w-[1100px]">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            setPaymentOpen(false);
                            setSubmitError("");
                        }}
                        className="mb-5 inline-flex items-center gap-2 border-0 bg-transparent p-0 text-xs text-[#776f65]"
                    >
                        <span className="rotate-180">
                            <Icon name="arrow" size={14} />
                        </span>
                        Back
                    </button>
                    <span className="mb-2 block text-[9px] font-bold uppercase tracking-[0.16em] text-[#b08a52]">
                        Awaiting Deposit
                    </span>
                    <h1 className="mb-2 text-[28px] font-normal leading-tight tracking-[-0.04em]">
                        Secure Your Reservation
                    </h1>
                    <p className="mb-6 text-xs leading-relaxed text-[#776f65]">
                        Submit your {money(reservation.deposit)} reservation deposit for
                        verification.
                    </p>
                    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <section className="min-w-0 rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-5 md:p-7">
                            <div className="mb-6 flex items-center justify-between gap-4 rounded-lg bg-[#4c3425] px-4 py-4 text-white">
                                <div className="flex items-center gap-3">
                                    <Icon name="clock" size={19} />
                                    <div>
                                        <small className="block text-[9px] text-[#d8c9bc]">
                                            Deposit deadline
                                        </small>
                                        <b className="text-xs font-semibold tabular-nums">
                                            {countdown}
                                        </b>
                                    </div>
                                </div>
                                <strong className="text-xl">
                                    {money(reservation.deposit)}
                                </strong>
                            </div>
                            {reservation.partial_payment_authorized && (
                                <p className="mb-5 rounded-lg border border-[#c9d8d3] bg-[#e6efed] p-4 text-xs leading-relaxed text-[#386247]">
                                    <b>Authorized partial-payment terms:</b>{" "}{reservation.partial_payment_terms}
                                </p>
                            )}
                            {!canPay && (
                                <p
                                    role="status"
                                    className="mb-5 rounded-lg bg-[#f6ecd7] p-4 text-xs text-[#805c27]"
                                >
                                    Payment is currently unavailable. Refresh the reservation
                                    status or contact the resort.
                                </p>
                            )}
                            {methods.length === 0 && (
                                <p
                                    role="status"
                                    className="mb-5 rounded-lg bg-[#f6ecd7] p-4 text-xs text-[#805c27]"
                                >
                                    No receiving account is configured. Contact the resort before
                                    transferring money.
                                </p>
                            )}
                            <form onSubmit={(event) => void submitReceipt(event)}>
                                <fieldset
                                    disabled={busy || !canPay || !method}
                                    className="min-w-0 border-0 p-0"
                                >
                                    <legend className="mb-3 text-sm font-semibold">
                                        Select Payment Method
                                    </legend>
                                    <div className="mb-5 grid gap-3 sm:grid-cols-2">
                                        {methods.map((account) => (
                                            <label
                                                key={account.id}
                                                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${methodId === String(account.id) ? "border-[#527a76] bg-[#e6efed]" : "border-[#e3d9cb] bg-[#fffdf8]"}`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="receiving_account"
                                                    checked={methodId === String(account.id)}
                                                    onChange={() => setMethodId(String(account.id))}
                                                    className="accent-[#527a76]"
                                                />
                                                <span
                                                    className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${account.name === "GCash" ? "bg-[#1786d0] text-white" : "bg-[#efbd4c] text-[#4c3425]"}`}
                                                >
                                                    {account.name.slice(0, 1)}
                                                </span>
                                                <span>
                                                    <b className="block text-xs font-semibold">
                                                        {account.name}
                                                    </b>
                                                    <small className="mt-1 block text-[8px] text-[#776f65]">
                                                        Use your {account.name} app
                                                    </small>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                    {method && (
                                        <div className="mb-5 flex flex-col items-center justify-between gap-5 rounded-lg bg-[#f6f1e7] p-5 sm:flex-row">
                                            <div className="min-w-0">
                                                <span className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-[#b08a52]">
                                                    Pay via {method.name}
                                                </span>
                                                <strong className="block text-xl font-semibold">
                                                    Carlos Paradise
                                                </strong>
                                                <p className="mt-2 mb-0 text-[10px] leading-relaxed text-[#776f65]">
                                                    Scan the QR code using your {method.name} app.
                                                </p>
                                            </div>
                                            {method.qr_code_url ? (
                                                <img
                                                    src={method.qr_code_url}
                                                    alt={
                                                        method.name +
                                                        " payment QR code for Carlos Paradise"
                                                    }
                                                    className="size-32 shrink-0 rounded-lg border border-[#e3d9cb] bg-white object-contain p-2"
                                                />
                                            ) : (
                                                <div
                                                    role="status"
                                                    className="grid size-32 shrink-0 place-items-center rounded-lg border border-dashed border-[#b08a52] bg-white p-3 text-center text-[9px] font-semibold text-[#776f65]"
                                                >
                                                    QR code not configured
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                                        <Field label="Amount Paid">
                                            <input
                                                aria-label="Amount Paid"
                                                aria-invalid={amountBelowRequired}
                                                aria-describedby={`payment-amount-help-${reservation.id}`}
                                                className={`${input} ${amountBelowRequired ? "border-[#a44b45] focus:border-[#a44b45] focus:ring-[#a44b45]/15" : ""}`}
                                                name="amount"
                                                type="number"
                                                min={reservation.partial_payment_authorized ? "1" : String(requiredDeposit)}
                                                max="99999999"
                                                step="0.01"
                                                inputMode="decimal"
                                                value={paymentAmount}
                                                onChange={(event) => {
                                                    setPaymentAmount(event.target.value);
                                                    setSubmitError("");
                                                }}
                                                required
                                            />
                                            <small
                                                id={`payment-amount-help-${reservation.id}`}
                                                className={`text-[9px] leading-relaxed ${amountBelowRequired ? "font-semibold text-[#a44b45]" : "text-[#776f65]"}`}
                                            >
                                                {amountBelowRequired
                                                    ? `Amount Paid must be at least ${money(requiredDeposit)}.`
                                                    : "Enter the amount shown on your payment receipt."}
                                            </small>
                                        </Field>
                                        <Field label="Payment Reference Number">
                                            <input
                                                className={input}
                                                name="reference"
                                                minLength={5}
                                                maxLength={100}
                                                placeholder="Enter reference number"
                                                required
                                            />
                                        </Field>
                                        <Field label="Date of Payment">
                                            <input
                                                className={input}
                                                name="payment_date"
                                                type="date"
                                                max={manilaToday()}
                                                defaultValue={manilaToday()}
                                                required
                                            />
                                        </Field>
                                        <Field label="Upload Payment Receipt">
                                            <input
                                                className="min-h-[46px] w-full min-w-0 rounded-lg border border-dashed border-[#bdb3a7] bg-white p-2 text-[10px] font-normal text-[#776f65] file:mr-2 file:rounded file:border-0 file:bg-[#f6f1e7] file:px-2 file:py-2 file:text-[10px] file:font-semibold file:text-[#4c3425]"
                                                type="file"
                                                name="receipt"
                                                aria-label="Upload Payment Receipt"
                                                accept="image/jpeg,image/png"
                                                onChange={(event) => {
                                                    const receipt = event.target.files?.[0];
                                                    if (receipt && !["image/jpeg", "image/png"].includes(receipt.type)) {
                                                        event.target.value = "";
                                                        setReceiptName("");
                                                        setSubmitError("Choose a JPG or PNG receipt.");
                                                        return;
                                                    }
                                                    setSubmitError("");
                                                    setReceiptName(receipt?.name || "");
                                                }}
                                                required
                                            />
                                            <small className="text-[9px] font-normal text-[#776f65]">
                                                {receiptName || "JPG or PNG · Up to 5 MB"}
                                            </small>
                                        </Field>
                                    </div>
                                    <div className="my-6">
                                        <SummaryRow
                                            label="Required deposit"
                                            value={money(reservation.deposit)}
                                        />
                                        <SummaryRow
                                            label="Amount to transfer"
                                            value={money(paymentAmount || 0)}
                                        />
                                        <SummaryRow label="Receipt status" value="Not submitted" />
                                    </div>
                                    {submitError && (
                                        <p
                                            role="alert"
                                            className="mb-4 rounded-lg bg-[#f7e6e3] p-3 text-xs text-[#a44b45]"
                                        >
                                            {submitError}
                                        </p>
                                    )}
                                    <button
                                        className={`${primary} w-full`}
                                        type="submit"
                                        disabled={busy || !canPay || !method || amountBelowRequired}
                                    >
                                        {busy
                                            ? "Submitting receipt…"
                                            : "Submit Payment for Verification"}
                                    </button>
                                    <p className="mt-3 mb-0 text-center text-[9px] leading-relaxed text-[#776f65]">
                                        Your reservation is confirmed after staff verify and approve
                                        the required deposit.
                                    </p>
                                </fieldset>
                            </form>
                        </section>
                        <aside className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-5">
                            <Icon name="calendar" size={21} />
                            <h2 className="mt-3 mb-5 text-sm font-semibold">
                                Reservation Details
                            </h2>
                            <div className="space-y-5">
                                {[
                                    ["Reservation ID", reservation.reference],
                                    [
                                        "Check-in",
                                        `${date(reservation.starts_at)} · ${time(reservation.starts_at)}`,
                                    ],
                                    [
                                        "Check-out",
                                        `${date(reservation.ends_at)} · ${time(reservation.ends_at)}`,
                                    ],
                                    ["Duration", duration(reservation)],
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <span className="mb-1.5 block text-[9px] text-[#776f65]">
                                            {label}
                                        </span>
                                        <b className="block text-xs font-semibold wrap-anywhere">
                                            {value}
                                        </b>
                                    </div>
                                ))}
                            </div>
                            <hr className="my-5 border-0 border-t border-[#e3d9cb]" />
                            <Icon name="shield" size={21} />
                            <p className="mt-3 mb-0 text-xs leading-6 text-[#776f65]">
                                Leaving this page does not cancel your request or restart the
                                original deposit deadline.
                            </p>
                        </aside>
                    </div>
                </section>
            ) : (
                <article className="mx-auto max-w-[780px] rounded-[20px] border border-[#e3d9cb] bg-[#fffdf8] px-6 py-10 text-center shadow-[0_12px_30px_rgba(63,47,33,0.04)] md:px-14 md:py-14">
                    <div
                        className={`mx-auto mb-7 grid size-[84px] place-items-center rounded-full ${review ? "bg-[#e6efed] text-[#527a76]" : "bg-[#e8eee5] text-[#607466]"}`}
                    >
                        <Icon
                            name={
                                confirmed || review || waiting || canPay ? "check" : "clock"
                            }
                            size={34}
                        />
                    </div>
                    <span className="mb-4 block text-xs font-bold uppercase tracking-[0.16em] text-[#b08a52]">
                        {review ? "Receipt Received" : "Request Received"}
                    </span>
                    <h1 className="mb-4 text-[28px] font-normal leading-tight tracking-[-0.045em] md:text-[34px]">
                        {review
                            ? "Payment Submitted"
                            : ["pending", "queued", "awaiting_deposit"].includes(
                                reservation.status,
                            )
                                ? "Reservation Request Submitted"
                                : badge}
                    </h1>
                    <p className="mx-auto mb-8 max-w-[650px] text-sm leading-7 text-[#776f65]">
                        {description}
                    </p>
                    <div className="mb-6 grid items-center gap-5 rounded-xl bg-[#f6f1e7] p-5 text-left sm:grid-cols-[1.4fr_1fr] md:p-6">
                        <div>
                            <span className="mb-2 block text-xs text-[#776f65]">
                                Requested dates
                            </span>
                            <b className="text-sm font-semibold">
                                {date(reservation.starts_at)} – {date(reservation.ends_at)}
                            </b>
                            <small className="mt-2 block text-[10px] text-[#776f65]">
                                {reservation.reference}
                            </small>
                        </div>
                        <div>
                            <span className="mb-2 block text-xs text-[#776f65]">
                                Current status
                            </span>
                            <span
                                className={`inline-flex rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-wide ${confirmed ? "bg-[#e8eee5] text-[#59754f]" : waiting ? "bg-[#f6ecd7] text-[#805c27]" : "bg-[#e6efed] text-[#527a76]"}`}
                            >
                                {badge}
                            </span>
                        </div>
                    </div>
                    <div className="mb-7 grid gap-5 rounded-xl bg-[#f6f1e7] p-5 text-left sm:grid-cols-2">
                        <div>
                            <span className="mb-2 block text-[10px] text-[#776f65]">
                                Reservation submitted
                            </span>
                            <b className="text-sm font-semibold">
                                {reservation.requested_at
                                    ? timestamp(reservation.requested_at)
                                    : "Saved successfully"}
                            </b>
                        </div>
                        <div>
                            <span className="mb-2 block text-[10px] text-[#776f65]">
                                {review ? "Receipt status" : "Deposit deadline"}
                            </span>
                            <b className="block text-sm font-semibold">
                                {review
                                    ? "Awaiting staff verification"
                                    : waiting
                                        ? "Not started — awaiting opportunity"
                                        : countdown}
                            </b>
                            {reservation.deadline && !confirmed && !review && (
                                <small className="mt-2 block text-[10px] text-[#776f65]">
                                    {timestamp(reservation.deadline)}
                                </small>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        {["pending", "queued", "awaiting_deposit"].includes(
                            reservation.status,
                        ) && (
                                <button
                                    type="button"
                                    className={primary}
                                    disabled={!canPay}
                                    onClick={() => {
                                        setPaymentOpen(true);
                                        setSubmitError("");
                                        window.scrollTo({ top: 0, behavior: "smooth" });
                                    }}
                                >
                                    Pay {money(reservation.deposit)} Reservation Deposit
                                </button>
                            )}
                        {onDashboard && (
                            <button
                                className="min-h-11 border-0 bg-transparent px-3 py-2 text-sm font-semibold text-[#4c3425]"
                                type="button"
                                onClick={onDashboard}
                            >
                                Back to Dashboard
                            </button>
                        )}
                        {!onDashboard && onReservations && (
                            <button
                                className="min-h-11 border-0 bg-transparent px-3 py-2 text-sm font-semibold text-[#4c3425]"
                                type="button"
                                onClick={onReservations}
                            >
                                My Reservations
                            </button>
                        )}
                    </div>
                    {!canPay && waiting && (
                        <p className="mt-4 mb-0 text-[10px] text-[#776f65]">
                            Payment becomes available after staff grant a deposit opportunity.
                        </p>
                    )}
                </article>
            )}
        </div>
    );
}
