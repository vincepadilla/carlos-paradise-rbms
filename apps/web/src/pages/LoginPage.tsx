import { useState, type FormEvent } from "react";
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
    validateLogin,
    type LoginErrors,
} from "../components/auth/AuthValidation";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(false);
    const [errors, setErrors] = useState<LoginErrors>({});
    const [notice, setNotice] = useState("");

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setNotice("");
        const next = validateLogin(email, password);
        setErrors(next);
        if (Object.keys(next).length) {
            focusFirstError("login", next);
            return;
        }
        // Connect the Laravel login endpoint here later. Never save passwords in browser storage.
        setNotice(
            "Your form passed validation. Sign-in will work after Laravel authentication is connected.",
        );
        setPassword("");
    }

    return (
        <AuthLayout>
            <AuthHeading
                eyebrow="Welcome back"
                title="Sign in to your account"
                description="Manage your requests, payments, and confirmed stays."
            />
            <form noValidate onSubmit={submit} className="mt-[30px]">
                <Field
                    id="login-email"
                    name="email"
                    label="Email Address"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    maxLength={255}
                    value={email}
                    onChange={(e) => {
                        setEmail(e.target.value);
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
                                "Password recovery will be available after Laravel authentication and email delivery are connected.",
                            )
                        }
                        className="cursor-pointer font-bold text-brown hover:underline"
                    >
                        Forgot password?
                    </button>
                </div>
                <AuthButton type="submit">Sign In →</AuthButton>
                {notice && (
                    <p
                        role="status"
                        className="mt-4 rounded-lg border border-line bg-sage-pale p-3 text-sm leading-relaxed text-brown"
                    >
                        {notice}
                    </p>
                )}
            </form>
            <p className="mt-6 text-center text-muted">
                Don&apos;t have an account?{" "}
                <Link to="/register" className="font-bold text-brown hover:underline">
                    Create one
                </Link>
            </p>
            <PreviewNotice />
        </AuthLayout>
    );
}
