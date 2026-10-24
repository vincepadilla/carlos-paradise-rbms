import { useEffect, useRef, useState } from "react";
import { AuthButton, AuthHeading } from "./AuthFields";

export const DEMO_OTP = "246810";
const duration = 5 * 60 * 1000;

export default function OtpVerification({
    email,
    onVerified,
    onBack,
}: {
    email: string;
    onVerified: () => void;
    onBack: () => void;
}) {
    const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
    const [deadline, setDeadline] = useState(() => Date.now() + duration);
    const [remaining, setRemaining] = useState(300);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const refs = useRef<Array<HTMLInputElement | null>>([]);

    useEffect(() => {
        const tick = () =>
            setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [deadline]);

    function update(index: number, value: string) {
        const digit = value.replace(/\D/g, "").slice(-1);
        setDigits((current) => current.map((v, i) => (i === index ? digit : v)));
        setError("");
        if (digit && index < 5) refs.current[index + 1]?.focus();
    }

    function verify() {
        setNotice("");
        if (Date.now() >= deadline)
            return setError(
                "This demo code expired. Restart the timer to try again.",
            );
        if (digits.join("").length !== 6) return setError("Enter all six digits.");
        if (digits.join("") !== DEMO_OTP)
            return setError("Invalid demo code. Please try again.");
        onVerified();
    }

    const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    return (
        <section className="text-center">
            <div
                aria-hidden="true"
                className="mx-auto mb-5 grid size-[58px] place-items-center rounded-full bg-cream text-2xl text-gold"
            >
                ✉
            </div>
            <AuthHeading
                eyebrow="Email Verification"
                title="Verify Your Account"
                description={`Preview the verification step for ${email}. No email has been sent.`}
            />
            <form
                className="mt-6"
                onSubmit={(e) => {
                    e.preventDefault();
                    verify();
                }}
            >
                <div
                    role="group"
                    aria-label="Six-digit verification code"
                    className="mb-[18px] grid grid-cols-6 gap-[9px] max-[430px]:gap-[5px]"
                    onPaste={(e) => {
                        const pasted = e.clipboardData
                            .getData("text")
                            .replace(/\D/g, "")
                            .slice(0, 6);
                        if (!pasted) return;
                        e.preventDefault();
                        setDigits(Array.from({ length: 6 }, (_, i) => pasted[i] ?? ""));
                        setError("");
                        refs.current[Math.min(pasted.length, 5)]?.focus();
                    }}
                >
                    {digits.map((digit, index) => (
                        <input
                            key={index}
                            ref={(node) => {
                                refs.current[index] = node;
                            }}
                            aria-label={`Verification digit ${index + 1}`}
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? "otp-error" : "otp-help"}
                            value={digit}
                            onChange={(e) => update(index, e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Backspace" && !digit && index > 0)
                                    refs.current[index - 1]?.focus();
                                if (e.key === "ArrowLeft" && index > 0)
                                    refs.current[index - 1]?.focus();
                                if (e.key === "ArrowRight" && index < 5)
                                    refs.current[index + 1]?.focus();
                            }}
                            inputMode="numeric"
                            autoComplete={index === 0 ? "one-time-code" : "off"}
                            maxLength={1}
                            className="h-[58px] min-w-0 rounded-[9px] border border-line bg-white text-center text-[22px] font-extrabold outline-none focus:border-gold focus:ring-[3px] focus:ring-gold/15 max-[430px]:h-[50px]"
                        />
                    ))}
                </div>
                {error && (
                    <p
                        id="otp-error"
                        role="alert"
                        className="mb-4 text-sm text-[#a44b45]"
                    >
                        {error}
                    </p>
                )}
                <p
                    className={`mb-[18px] rounded-lg border border-line p-3 ${remaining === 0 ? "bg-[#f7e6e3] text-[#a44b45]" : "bg-cream text-muted"}`}
                >
                    Demo code expires in <b>{countdown}</b>
                </p>
                <AuthButton type="submit">Verify OTP →</AuthButton>
                <div className="mt-[9px]">
                    <AuthButton
                        secondary
                        onClick={() => {
                            setDigits(Array(6).fill(""));
                            setDeadline(Date.now() + duration);
                            setRemaining(300);
                            setError("");
                            setNotice("Demo timer restarted. No email was sent.");
                            refs.current[0]?.focus();
                        }}
                    >
                        Resend Code
                    </AuthButton>
                </div>
                {notice && (
                    <p role="status" className="mt-3 text-xs text-muted">
                        {notice}
                    </p>
                )}
                <p id="otp-help" className="mt-[18px] text-xs text-muted">
                    Prototype verification code: <b>{DEMO_OTP}</b>. This verifies the UI
                    preview only.
                </p>
                <button
                    type="button"
                    onClick={onBack}
                    className="mt-5 cursor-pointer text-sm font-bold text-brown underline underline-offset-4"
                >
                    Edit account details
                </button>
            </form>
        </section>
    );
}
