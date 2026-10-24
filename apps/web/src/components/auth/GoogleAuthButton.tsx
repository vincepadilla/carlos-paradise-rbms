import { useState } from "react";
import { Link, useSearchParams } from "react-router";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

const googleMessages: Record<string, string> = {
    not_registered:
        "This Google account is not registered. Please sign up first.",
    cancelled: "Google sign-in was cancelled. You can try again.",
    expired: "Google sign-in expired. Please start again from this button.",
    unverified: "Google could not provide a verified email for this account.",
    existing_account:
        "This email already has an account. Sign in using your password. Linking Google to an existing account is not available yet.",
    signup_required:
        "To create an account, agree to the terms below, then choose Continue with Google.",
    unavailable_account:
        "Unable to sign in with this account. Please contact the resort for help.",
    unavailable: "Google sign-in is unavailable right now. Please try again later.",
};

type GoogleAuthButtonProps = {
    intent?: "login" | "register";
    termsAccepted?: boolean;
    disabled?: boolean;
};

function GoogleIcon() {
    return (
        <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 48 48"
            className="shrink-0"
        >
            <path
                fill="#4285F4"
                d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.62c3.87-3.56 6.07-8.8 6.07-14.82Z"
            />
            <path
                fill="#34A853"
                d="M24 44c5.5 0 10.11-1.82 13.48-4.93l-6.62-5.14c-1.83 1.23-4.18 1.96-6.86 1.96-5.32 0-9.83-3.59-11.44-8.42H5.72v5.3A20.36 20.36 0 0 0 24 44Z"
            />
            <path
                fill="#FBBC05"
                d="M12.56 27.47A12.22 12.22 0 0 1 11.92 24c0-1.2.22-2.37.64-3.47v-5.3H5.72A20 20 0 0 0 3.6 24c0 3.23.77 6.29 2.12 8.77l6.84-5.3Z"
            />
            <path
                fill="#EA4335"
                d="M24 12.11c3 0 5.68 1.03 7.8 3.05l5.85-5.85C34.1 6 29.5 4 24 4A20.36 20.36 0 0 0 5.72 15.23l6.84 5.3C14.17 15.7 18.68 12.11 24 12.11Z"
            />
        </svg>
    );
}

export default function GoogleAuthButton({
    intent = "login",
    termsAccepted = false,
    disabled = false,
}: GoogleAuthButtonProps) {
    const [searchParams] = useSearchParams();
    const [redirecting, setRedirecting] = useState(false);

    const code = searchParams.get("google_error");
    const message = code ? googleMessages[code] : undefined;
    const needsTerms = intent === "register" && !termsAccepted;

    function startGoogle() {
        if (disabled || redirecting || needsTerms) return;

        setRedirecting(true);

        const target = new URL(`${apiBaseUrl}/auth/google/redirect`);
        target.searchParams.set("from", intent);

        if (intent === "register" && termsAccepted) {
            target.searchParams.set("terms", "1");
        }

        window.location.assign(target.toString());
    }

    return (
        <div className="mt-5">
            {message && (
                <p
                    role="alert"
                    className="mb-3 text-sm leading-relaxed text-[#a44b45]"
                >
                    {message}

                    {code === "not_registered" && (
                        <>
                            {" "}
                            <Link
                                to="/register"
                                className="font-bold text-brown underline focus-visible:outline-2 focus-visible:outline-gold"
                            >
                                Create an account
                            </Link>
                        </>
                    )}
                </p>
            )}

            <div
                aria-hidden="true"
                className="mb-4 flex items-center gap-3 text-xs text-muted"
            >
                <span className="h-px flex-1 bg-line" />
                <span>or</span>
                <span className="h-px flex-1 bg-line" />
            </div>

            <button
                type="button"
                onClick={startGoogle}
                disabled={disabled || redirecting || needsTerms}
                aria-busy={redirecting}
                className="inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-3 rounded-[10px] border border-line bg-white px-5 text-sm font-semibold text-ink transition hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-60"
            >
                <GoogleIcon />

                <span>
                    {redirecting ? "Opening Google…" : "Continue with Google"}
                </span>
            </button>

            {needsTerms && (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                    Select the Terms and Privacy Policy checkbox above to continue.
                </p>
            )}
        </div>
    );
}