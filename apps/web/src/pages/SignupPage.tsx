import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import ReCAPTCHA from "react-google-recaptcha";
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
    meetsPasswordRequirements,
    validateSignup,
    type SignupErrors,
    type SignupValues,
} from "../components/auth/AuthValidation";
import { normalizeContactNumber } from "../utils/contactNumber";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

const signupDraftKey = "carlos-paradise:signup-draft";

const emptySignupValues: SignupValues = {
    name: "",
    email: "",
    contact: "",
    password: "",
    password_confirmation: "",
    terms: false,
};

function loadSignupDraft(): SignupValues {
    if (typeof window === "undefined") return emptySignupValues;

    try {
        const draft = JSON.parse(
            window.sessionStorage.getItem(signupDraftKey) ?? "{}",
        ) as Partial<SignupValues>;

        return {
            ...emptySignupValues,
            name: typeof draft.name === "string" ? draft.name : "",
            email: typeof draft.email === "string" ? draft.email : "",
            contact: typeof draft.contact === "string"
                ? normalizeContactNumber(draft.contact)
                : "",
            terms: typeof draft.terms === "boolean" ? draft.terms : false,
        };
    } catch {
        return emptySignupValues;
    }
}

function saveSignupDraft(
    values: Pick<SignupValues, "name" | "email" | "contact" | "terms">,
) {
    try {
        window.sessionStorage.setItem(
            signupDraftKey,
            JSON.stringify({
                name: values.name,
                email: values.email,
                contact: values.contact,
                terms: values.terms,
            }),
        );
    } catch {
        return;
    }
}

function clearSignupDraft() {
    try {
        window.sessionStorage.removeItem(signupDraftKey);
    } catch {
        return;
    }
}

export default function SignupPage() {
    const [step, setStep] = useState<"form" | "success">("form");
    const [values, setValues] = useState<SignupValues>(loadSignupDraft);
    const [errors, setErrors] = useState<SignupErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const submittingRef = useRef(false);
    const recaptchaRef = useRef<ReCAPTCHA>(null);
    const passwordRequirementsMet = meetsPasswordRequirements(values.password);

    useEffect(() => {
        if (step !== "form") return;
        saveSignupDraft({
            name: values.name,
            email: values.email,
            contact: values.contact,
            terms: values.terms,
        });
    }, [step, values.name, values.email, values.contact, values.terms]);

    function change<K extends keyof SignupValues>(
        key: K,
        value: SignupValues[K],
    ) {
        setFormError(null);
        setValues((current) => ({ ...current, [key]: value }));
        setErrors((current) => ({ ...current, [key]: undefined }));
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submittingRef.current) return;

        const captchaToken = recaptchaRef.current?.getValue();
        if (!captchaToken) {
            setFormError("Please complete the CAPTCHA verification.");
            return;
        }

        const next = validateSignup(values);
        setErrors(next);
        setFormError(null);
        if (Object.keys(next).length) {
            focusFirstError("signup", next);
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
                recaptchaRef.current?.reset();
                throw new Error("CSRF initialization failed");
            }

            const xsrfCookie = document.cookie.split("; ").find(
                (cookie) => cookie.startsWith("XSRF-TOKEN="),
            );
            const xsrfToken = xsrfCookie
                ? decodeURIComponent(xsrfCookie.substring("XSRF-TOKEN=".length))
                : null;
                
            if (!xsrfToken) {
                recaptchaRef.current?.reset();
                throw new Error("CSRF cookie is unavailable");
            }

            const response = await fetch(`${apiBaseUrl}/api/register`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "X-XSRF-TOKEN": xsrfToken,
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: values.name.trim(),
                    email: values.email.trim().toLowerCase(),
                    phone: values.contact.trim(),
                    password: values.password,
                    password_confirmation: values.password_confirmation,
                    terms: values.terms,
                    captcha_token: captchaToken,
                }),
            });

            const payload: unknown = await response.json().catch(() => null);
            const data =
                payload !== null && typeof payload === "object"
                    ? (payload as Record<string, unknown>)
                    : null;

            if (!response.ok) {
                recaptchaRef.current?.reset();
                
                if (response.status === 422 && data?.errors &&
                    typeof data.errors === "object") {
                    const validation = data.errors as Record<string, unknown>;
                    const fieldErrors: SignupErrors = {};
                    const fieldMap = {
                        name: "name",
                        email: "email",
                        phone: "contact",
                        password: "password",
                        password_confirmation: "password_confirmation",
                        terms: "terms",
                    } as const;

                    for (const [apiField, formField] of Object.entries(fieldMap)) {
                        const messages = validation[apiField];
                        if (Array.isArray(messages) &&
                            typeof messages[0] === "string") {
                            fieldErrors[formField as keyof SignupErrors] = messages[0];
                        }
                    }

                    setErrors(fieldErrors);
                    
                    const captchaError = validation["captcha_token"];
                    if (Array.isArray(captchaError) && typeof captchaError[0] === "string") {
                        setFormError(captchaError[0]);
                    } else {
                        setFormError("Please check the highlighted fields.");
                        focusFirstError("signup", fieldErrors);
                    }
                } else if (response.status === 419) {
                    setFormError(
                        "Your session has expired. Refresh the page and try again.",
                    );
                } else if (response.status === 429) {
                    setFormError(
                        "Too many attempts. Please wait a minute and try again.",
                    );
                } else {
                    setFormError(
                        "Registration could not be completed. Please try again later.",
                    );
                }
                return;
            }

            if (!data || !data.user || typeof data.user !== "object") {
                setFormError(
                    "The server returned an unexpected response. Check your account status before trying again.",
                );
                return;
            }

            clearSignupDraft();
            setValues((current) => ({
                ...current,
                name: current.name.trim(),
                email: current.email.trim().toLowerCase(),
                password: "",
                password_confirmation: "",
            }));
            setStep("success");
        } catch {
            recaptchaRef.current?.reset();
            setFormError(
                "Could not confirm registration. Check your connection. If it continues, check whether the account was created before trying again.",
            );
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <AuthLayout>
            {step === "form" ? (
                <>
                    <AuthHeading
                        eyebrow="Join Carlos Paradise"
                        title="Create your account"
                        description="Save your details and follow your reservation request."
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
                            <div className="grid grid-cols-1 gap-x-4 min-[560px]:grid-cols-2">
                                <Field
                                    id="signup-name"
                                    name="name"
                                    label="Full Name"
                                    placeholder="Your full name"
                                    autoComplete="name"
                                    required
                                    maxLength={120}
                                    value={values.name}
                                    onChange={(e) => change("name", e.target.value)}
                                    error={errors.name}
                                    reserveMessageSpace
                                />
                                <Field
                                    id="signup-contact"
                                    name="contact"
                                    label="Contact Number"
                                    type="tel"
                                    placeholder="09XXXXXXXXX"
                                    autoComplete="tel"
                                    inputMode="numeric"
                                    pattern="09[0-9]{9}"
                                    required
                                    maxLength={11}
                                    value={values.contact}
                                    onChange={(e) =>
                                        change(
                                            "contact",
                                            normalizeContactNumber(e.target.value),
                                        )
                                    }
                                    error={errors.contact}
                                    reserveMessageSpace
                                />
                                <div className="min-[560px]:col-span-2">
                                    <Field
                                        id="signup-email"
                                        name="email"
                                        label="Email Address"
                                        type="email"
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        required
                                        maxLength={254}
                                        value={values.email}
                                        onChange={(e) => change("email", e.target.value)}
                                        error={errors.email}
                                        reserveMessageSpace
                                    />
                                </div>
                                <PasswordField
                                    id="signup-password"
                                    name="password"
                                    label="Password"
                                    placeholder="Create a password"
                                    autoComplete="new-password"
                                    required
                                    maxLength={128}
                                    value={values.password}
                                    onChange={(e) => change("password", e.target.value)}
                                    error={errors.password}
                                    hint="Use 10+ chars, letters & numbers."
                                    hintSatisfied={passwordRequirementsMet}
                                    reserveMessageSpace
                                />
                                <PasswordField
                                    id="signup-password_confirmation"
                                    name="password_confirmation"
                                    label="Confirm Password"
                                    placeholder="Repeat your password"
                                    autoComplete="new-password"
                                    required
                                    maxLength={128}
                                    value={values.password_confirmation}
                                    onChange={(e) =>
                                        change("password_confirmation", e.target.value)
                                    }
                                    error={errors.password_confirmation}
                                    reserveMessageSpace
                                />
                            </div>
                            <div className="mt-5 text-xs text-muted">
                                <label className="flex cursor-pointer items-start gap-2 leading-relaxed">
                                    <input
                                        id="signup-terms"
                                        type="checkbox"
                                        checked={values.terms}
                                        onChange={(e) => change("terms", e.target.checked)}
                                        required
                                        aria-invalid={Boolean(errors.terms)}
                                        aria-describedby={
                                            errors.terms ? "signup-terms-error" : undefined
                                        }
                                        className="mt-0.5 size-4 shrink-0 accent-brown"
                                    />
                                    I agree to the Terms and Privacy Policy
                                </label>
                                <p
                                    id={errors.terms ? "signup-terms-error" : undefined}
                                    role={errors.terms ? "alert" : undefined}
                                    aria-hidden={errors.terms ? undefined : true}
                                    className="mt-1.5 min-h-[19px] text-[#a44b45]"
                                >
                                    {errors.terms || "\u00a0"}
                                </p>
                            </div>
                            
                            <div className="mb-5 flex justify-center">
                                <ReCAPTCHA 
                                    ref={recaptchaRef}
                                    sitekey={import.meta.env.VITE_RECAPTCHA_SITE_KEY} 
                                />
                            </div>

                            <AuthButton type="submit">
                                {isSubmitting ? "Creating account…" : "Create Account →"}
                            </AuthButton>
                        </fieldset>
                    </form>
                    <GoogleAuthButton
                        intent="register"
                        termsAccepted={values.terms}
                        disabled={isSubmitting}
                    />
                    <p className="mt-6 text-center text-muted">
                        Already have an account?{" "}
                        <Link to="/login" className="font-bold text-brown hover:underline">
                            Sign in
                        </Link>
                    </p>
                </>
            ) : (
                <section className="pt-[30px] text-center">
                    <div
                        aria-hidden="true"
                        className="mx-auto mb-5 grid size-[58px] place-items-center rounded-full bg-sage-pale text-2xl text-sage"
                    >
                        ✓
                    </div>
                    <AuthHeading
                        eyebrow="Account Created"
                        title="Your account has been created"
                        description="Your details have been saved. Your email is not verified yet; email verification will be available once it is connected."
                    />
                    <div className="mt-6">
                        <Link
                            to="/login"
                            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[10px] bg-brown px-5 font-bold text-white transition hover:bg-[#6e4b35]"
                        >
                            Back to Login →
                        </Link>
                    </div>
                </section>
            )}
        </AuthLayout>
    );
}
