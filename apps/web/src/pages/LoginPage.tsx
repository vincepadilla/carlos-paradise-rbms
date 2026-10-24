import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import AuthLayout from "../components/auth/AuthLayout";
import GoogleAuthButton from "../components/auth/GoogleAuthButton";
import {
    AuthButton,
    AuthHeading,
    Field,
    PasswordField,
} from "../components/auth/AuthFields";
import {
    focusFirstError,
    validateLogin,
    type LoginErrors,
} from "../components/auth/AuthValidation";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
    const payload: unknown = await response.json().catch(() => null);
    return payload !== null && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
}

export default function LoginPage() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(false);
    const [errors, setErrors] = useState<LoginErrors>({});
    const [notice, setNotice] = useState("");
    const [formError, setFormError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submittingRef = useRef(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submittingRef.current) return;

        setNotice("");
        setFormError("");
        const next = validateLogin(email, password);
        setErrors(next);
        if (Object.keys(next).length) {
            focusFirstError("login", next);
            return;
        }

        submittingRef.current = true;
        setIsSubmitting(true);

        try {
            const csrfResponse = await fetch(`${apiBaseUrl}/sanctum/csrf-cookie`, {
                headers: { Accept: "application/json" },
                credentials: "include",
            });
            if (!csrfResponse.ok) {
                setFormError("Could not initialize sign-in. Please try again later.");
                return;
            }

            const cookie = document.cookie.split("; ").find(
                (item) => item.startsWith("XSRF-TOKEN="),
            );
            const csrfToken = cookie
                ? decodeURIComponent(cookie.substring("XSRF-TOKEN=".length))
                : null;

            if (!csrfToken) {
                setFormError(
                    "The sign-in cookie is unavailable. Use localhost for both apps and check your cookie settings.",
                );
                return;
            }

            const response = await fetch(`${apiBaseUrl}/auth/login`, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-XSRF-TOKEN": csrfToken,
                },
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    password,
                    remember,
                }),
            });

            const data = await readJson(response);

            if (!response.ok) {
                if (response.status === 422 && data?.errors &&
                    typeof data.errors === "object") {
                    const validation = data.errors as Record<string, unknown>;
                    const fieldErrors: LoginErrors = {};
                    for (const field of ["email", "password"] as const) {
                        const messages = validation[field];
                        if (Array.isArray(messages) &&
                            typeof messages[0] === "string") {
                            fieldErrors[field] = messages[0];
                        }
                    }
                    setErrors(fieldErrors);
                    setFormError("Unable to sign in. Check your details and try again.");
                    focusFirstError("login", fieldErrors);
                } else if (response.status === 419) {
                    setFormError("Your session expired. Refresh the page and try again.");
                } else if (response.status === 429) {
                    setFormError("Too many attempts. Please wait a minute and try again.");
                } else {
                    setFormError("Sign-in is unavailable right now. Please try again later.");
                }
                return;
            }

            if (!data?.user || typeof data.user !== "object") {
                setFormError("The server returned an unexpected sign-in response.");
                return;
            }

            // Confirm that Laravel recognizes the session on a NEW request.
            const sessionResponse = await fetch(`${apiBaseUrl}/auth/user`, {
                headers: { Accept: "application/json" },
                credentials: "include",
                cache: "no-store",
            });
            const sessionData = await readJson(sessionResponse);
            if (!sessionResponse.ok || !sessionData?.user ||
                typeof sessionData.user !== "object") {
                setFormError(
                    "Your login was accepted, but the session could not be confirmed. Check the session and cookie configuration.",
                );
                return;
            }

            setPassword("");
            // The landing page already exists. Change this to your guest page
            // once its route is ready; backend permissions must still be enforced.
            navigate("/", { replace: true });
        } catch {
            setFormError(
                "Could not confirm sign-in. Check your connection and that Laravel is running.",
            );
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <AuthLayout edgeToEdgeImage>
            <AuthHeading
                eyebrow="Welcome back"
                title="Sign in to your account"
                description="Manage your requests, payments, and confirmed stays."
            />
            <form noValidate onSubmit={submit} className="mt-[30px]"
                aria-busy={isSubmitting}>
                {formError && (
                    <p role="alert" className="mb-4 text-sm text-[#a44b45]">
                        {formError}
                    </p>
                )}
                <fieldset disabled={isSubmitting}
                    className="m-0 min-w-0 border-0 p-0 disabled:opacity-70">
                    <Field
                        id="login-email"
                        name="email"
                        label="Email Address"
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            setFormError("");
                            setErrors((v) => ({ ...v, email: undefined }));
                        }}
                        error={errors.email}
                    />
                    <PasswordField
                        id="login-password"
                        name="password"
                        label="Password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            setFormError("");
                            setErrors((v) => ({ ...v, password: undefined }));
                        }}
                        error={errors.password}
                    />
                    <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="checkbox"
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                                className="size-4 accent-brown"
                            />
                            Remember me
                        </label>
                        <button
                            type="button"
                            onClick={() =>
                                setNotice(
                                    "Password recovery is not available yet. Please contact the resort for help.",
                                )
                            }
                            className="cursor-pointer font-bold text-brown hover:underline"
                        >
                            Forgot password?
                        </button>
                    </div>
                    <AuthButton type="submit">
                        {isSubmitting ? "Signing in…" : "Sign In →"}
                    </AuthButton>
                </fieldset>
                {notice && (
                    <p role="status"
                        className="mt-4 rounded-lg border border-line bg-sage-pale p-3 text-sm leading-relaxed text-brown">
                        {notice}
                    </p>
                )}
            </form>
            <GoogleAuthButton intent="login" disabled={isSubmitting} />
            <p className="mt-6 text-center text-muted">
                Don&apos;t have an account?{" "}
                <Link to="/register" className="font-bold text-brown hover:underline">
                    Create one
                </Link>
            </p>
        </AuthLayout>
    );
}
