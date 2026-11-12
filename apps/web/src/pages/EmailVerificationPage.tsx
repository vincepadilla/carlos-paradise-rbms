import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { Link } from "react-router";
import AuthLayout from "../components/auth/AuthLayout";
import { AuthHeading } from "../components/auth/AuthFields";
import {
    clearPendingVerification, loadPendingVerification, readVerification,
    savePendingVerification, verificationRequest, type PendingVerification,
} from "../services/EmailVerification";

const emptyCode = () => Array<string>(6).fill("");
const secondsUntil = (value: string) => Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
const clock = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function ShieldIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-7" fill="none"
        stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 5.5 5.7v5.4c0 4.4 2.7 7.8 6.5 9.9 3.8-2.1 6.5-5.5 6.5-9.9V5.7L12 3Z" />
        <path d="m9.5 12 1.7 1.7 3.6-3.8" />
    </svg>;
}

function SuccessState() {
    return <section className="text-center">
        <div aria-hidden="true" className="mx-auto mb-6 grid size-[68px] place-items-center rounded-full bg-sage-pale text-[32px] text-[#4f7b5d]">✓</div>
        <AuthHeading eyebrow="Verification Complete" title="Account Verified Successfully"
            description="Your account has been verified successfully." />
        <Link to="/login" className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] border border-brown bg-brown px-5 font-bold text-white shadow-[0_8px_20px_rgba(76,52,37,.18)] transition hover:-translate-y-px">
            Continue to Login
        </Link>
    </section>;
}

export default function EmailVerificationPage() {
    const [pending, setPending] = useState<PendingVerification | null>(loadPendingVerification);
    const [digits, setDigits] = useState(emptyCode);
    const [remaining, setRemaining] = useState(() => pending ? secondsUntil(pending.expires_at) : 0);
    const [resendRemaining, setResendRemaining] = useState(() => pending ? secondsUntil(pending.resend_available_at) : 0);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
    const [complete, setComplete] = useState(false);
    const refs = useRef<Array<HTMLInputElement | null>>([]);

    useEffect(() => {
        if (!pending || complete) return;
        const update = () => {
            setRemaining(secondsUntil(pending.expires_at));
            setResendRemaining(secondsUntil(pending.resend_available_at));
        };
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [pending, complete]);

    useEffect(() => {
        if (!pending || complete || pending.delivery_status !== "queued") return;
        let stopped = false;
        const poll = async () => {
            try {
                const { response, data } = await verificationRequest("status", { token: pending.token });
                const next = readVerification(data?.verification);
                if (!stopped && response.ok && next) {
                    savePendingVerification(next);
                    setPending(next);
                }
            } catch { /* Polling retries without blocking code entry. */ }
        };
        void poll();
        const timer = window.setInterval(poll, 2500);
        return () => { stopped = true; window.clearInterval(timer); };
    }, [pending, complete]);

    function updateDigit(index: number, raw: string) {
        const digit = raw.replace(/\D/g, "").slice(-1);
        setDigits((current) => current.map((value, i) => i === index ? digit : value));
        setError("");
        if (digit && index < 5) refs.current[index + 1]?.focus();
    }

    function paste(event: ClipboardEvent<HTMLDivElement>) {
        const value = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!value) return;
        event.preventDefault();
        setDigits(Array.from({ length: 6 }, (_, index) => value[index] ?? ""));
        setError("");
        refs.current[Math.min(value.length, 6) - 1]?.focus();
    }

    async function verify(event: FormEvent) {
        event.preventDefault();
        if (!pending || busy) return;
        const code = digits.join("");
        if (code.length !== 6) return setError("Enter all six digits.");
        if (remaining === 0) return setError("This verification code has expired. Request a new code.");
        setBusy("verify"); setError(""); setNotice("");
        try {
            const { response, data } = await verificationRequest("verify", { token: pending.token, code });
            if (response.ok) {
                clearPendingVerification();
                sessionStorage.removeItem("carlos-paradise:signup-draft");
                setComplete(true);
                return;
            }
            const message = typeof data?.message === "string" ? data.message : "";
            if (response.status === 410) setError("This verification code has expired. Request a new code.");
            else if (response.status === 422) setError(message || "The verification code is incorrect.");
            else if (response.status === 429) setError(message || "Too many attempts. Request a new code.");
            else setError(message || "Verification is unavailable right now. Please try again.");
        } catch { setError("Could not verify the code. Check your connection and try again."); }
        finally { setBusy(null); }
    }

    async function resend() {
        if (!pending || busy || resendRemaining > 0) return;
        setBusy("resend"); setError(""); setNotice("");
        try {
            const { response, data } = await verificationRequest("resend", { token: pending.token });
            const next = readVerification(data?.verification);
            if (response.ok && next) {
                savePendingVerification(next); setPending(next); setDigits(emptyCode());
                setNotice("A new verification code is being sent."); refs.current[0]?.focus();
                return;
            }
            const message = typeof data?.message === "string" ? data.message : "";
            setError(response.status === 429 ? message || "Please wait before requesting another code."
                : message || "We could not send a new code. Please try again.");
        } catch { setError("We could not send a new code. Check your connection and try again."); }
        finally { setBusy(null); }
    }

    return <AuthLayout>
        {complete ? <SuccessState /> : !pending ? <section className="text-center">
            <AuthHeading eyebrow="Email Verification" title="Verification session unavailable"
                description="Sign in with your email and password to resume verification." />
            <Link to="/login" className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] bg-brown px-5 font-bold text-white">Continue to Login</Link>
        </section> : <section className="text-center">
            <div aria-hidden="true" className="mx-auto mb-5 grid size-[60px] place-items-center rounded-full bg-cream text-gold"><ShieldIcon /></div>
            <AuthHeading eyebrow="Email Verification" title="Verify Your Account"
                description="We sent a verification code to your email address." />
            <p className="mt-2 font-bold text-brown">{pending.masked_email}</p>
            <form onSubmit={verify} className="mt-7" aria-busy={busy !== null}>
                <div role="group" aria-label="Six-digit verification code" onPaste={paste}
                    className="mb-5 grid grid-cols-6 gap-2 max-[430px]:gap-1.5">
                    {digits.map((digit, index) => <input key={index}
                        ref={(node) => { refs.current[index] = node; }}
                        aria-label={`Verification digit ${index + 1}`} aria-invalid={Boolean(error)}
                        aria-describedby={error ? "verification-error" : "verification-expiry"}
                        value={digit} onChange={(event) => updateDigit(index, event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Backspace" && !digit && index > 0) refs.current[index - 1]?.focus();
                            else if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
                            else if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
                        }} inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? "one-time-code" : "off"}
                        maxLength={1} disabled={busy !== null}
                        className="aspect-square min-w-0 rounded-[9px] border border-line bg-white text-center text-[22px] font-extrabold outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/15 disabled:opacity-60" />)}
                </div>
                <p id="verification-expiry" className={`mb-5 rounded-lg border p-3 ${remaining === 0 ? "border-[#e7c4bf] bg-[#f7e6e3] text-[#a44b45]" : "border-line bg-cream text-muted"}`}>
                    {remaining === 0 ? "Code expired" : <>Code expires in <b>{clock(remaining)}</b></>}
                </p>
                {pending.delivery_status === "queued" && <p role="status" className="mb-4 text-sm text-muted">Sending your verification email…</p>}
                {pending.delivery_status === "failed" && <p role="alert" className="mb-4 text-sm text-[#a44b45]">We could not send the email. Please use Resend Code.</p>}
                {error && <p id="verification-error" role="alert" className="mb-4 text-sm text-[#a44b45]">{error}</p>}
                {notice && <p role="status" className="mb-4 text-sm text-[#4f7b5d]">{notice}</p>}
                <button type="submit" disabled={busy !== null || remaining === 0}
                    className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] border border-brown bg-brown px-5 font-bold text-white shadow-[0_8px_20px_rgba(76,52,37,.18)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60">
                    {busy === "verify" ? "Verifying…" : "Verify OTP"}
                </button>
                <button type="button" onClick={resend} disabled={busy !== null || resendRemaining > 0}
                    className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-[10px] border border-brown bg-transparent px-5 font-bold text-brown transition hover:bg-cream disabled:cursor-not-allowed disabled:opacity-50">
                    {busy === "resend" ? "Sending…" : resendRemaining > 0 ? `Resend Code (${resendRemaining}s)` : "Resend Code"}
                </button>
            </form>
        </section>}
    </AuthLayout>;
}
