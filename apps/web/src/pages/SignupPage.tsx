import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import AuthLayout from "../components/auth/AuthLayout";
import {
    AuthButton,
    AuthHeading,
    Field,
    PasswordField,
    PreviewNotice,
} from "../components/auth/AuthFields";
import {
    focusFirstError,
    meetsPasswordRequirements,
    validateSignup,
    type SignupErrors,
    type SignupValues,
} from "../components/auth/AuthValidation";
import OtpVerification from "../components/auth/OtpVerification";

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
            contact: typeof draft.contact === "string" ? draft.contact : "",
            terms: typeof draft.terms === "boolean" ? draft.terms : false,
        };
    } catch {
        return emptySignupValues;
    }
}

function saveSignupDraft(values: SignupValues) {
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
    const [step, setStep] = useState<"form" | "otp" | "success">("form");
    const [values, setValues] = useState<SignupValues>(loadSignupDraft);
    const [errors, setErrors] = useState<SignupErrors>({});
    const passwordRequirementsMet = meetsPasswordRequirements(values.password);

    useEffect(() => {
        saveSignupDraft(values);
    }, [values.name, values.email, values.contact, values.terms]);

    function change<K extends keyof SignupValues>(
        key: K,
        value: SignupValues[K],
    ) {
        setValues((current) => ({ ...current, [key]: value }));
        setErrors((current) => ({ ...current, [key]: undefined }));
    }
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const next = validateSignup(values);
        setErrors(next);
        if (Object.keys(next).length) {
            focusFirstError("signup", next);
            return;
        }
        // Frontend preview only. A real registration/OTP flow must be handled by Laravel.
        setValues((v) => ({
            ...v,
            name: v.name.trim(),
            email: v.email.trim(),
            password: "",
            password_confirmation: "",
        }));
        setStep("otp");
    }

    function completeVerification() {
        clearSignupDraft();
        setStep("success");
    }

    return (
        <AuthLayout edgeToEdgeImage>
            {step === "form" ? (
                <>
                    <AuthHeading
                        eyebrow="Join Carlos Paradise"
                        title="Create your account"
                        description="Save your details and follow your reservation request."
                    />
                    <form noValidate onSubmit={submit} className="mt-[30px]">
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
                                placeholder="+63 912 345 6789"
                                autoComplete="tel"
                                required
                                maxLength={30}
                                value={values.contact}
                                onChange={(e) => change("contact", e.target.value)}
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
                                    maxLength={255}
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
                        <AuthButton type="submit">Create Account →</AuthButton>
                    </form>
                    <p className="mt-6 text-center text-muted">
                        Already have an account?{" "}
                        <Link to="/login" className="font-bold text-brown hover:underline">
                            Sign in
                        </Link>
                    </p>
                    <PreviewNotice />
                </>
            ) : step === "otp" ? (
                <>
                    <OtpVerification
                        email={values.email}
                        onVerified={completeVerification}
                        onBack={() => setStep("form")}
                    />
                    <PreviewNotice />
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
                        eyebrow="Verification Preview Complete"
                        title="You completed the signup preview"
                        description="The demo code was accepted. No real account has been created or verified yet."
                    />
                    <div className="mt-6">
                        <Link
                            to="/login"
                            className="inline-flex min-h-[46px] w-full items-center justify-center rounded-[10px] bg-brown px-5 font-bold text-white transition hover:bg-[#6e4b35]"
                        >
                            Continue to Login →
                        </Link>
                    </div>
                    <PreviewNotice />
                </section>
            )}
        </AuthLayout>
    );
}
