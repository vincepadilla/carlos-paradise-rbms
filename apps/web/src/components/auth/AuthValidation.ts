export type SignupValues = {
    name: string;
    email: string;
    contact: string;
    password: string;
    password_confirmation: string;
    terms: boolean;
};
export type SignupErrors = Partial<Record<keyof SignupValues, string>>;
export type LoginErrors = Partial<Record<"email" | "password", string>>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin(email: string, password: string): LoginErrors {
    const errors: LoginErrors = {};
    if (!emailPattern.test(email.trim()))
        errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    return errors;
}

export function validateSignup(v: SignupValues): SignupErrors {
    const errors: SignupErrors = {};
    if (v.name.trim().length < 2) errors.name = "Enter your full name.";
    if (!emailPattern.test(v.email.trim()))
        errors.email = "Enter a valid email address.";
    if (!/^(?:\+63|0)9\d{9}$/.test(v.contact.replace(/[\s()-]/g, "")))
        errors.contact = "Use 09XXXXXXXXX or +639XXXXXXXXX.";
    if (
        v.password.length < 10 ||
        !/[a-z]/i.test(v.password) ||
        !/\d/.test(v.password)
    )
        errors.password =
            "Use at least 10 characters, including letters and numbers.";
    if (!v.password_confirmation || v.password !== v.password_confirmation)
        errors.password_confirmation = "Passwords must match.";
    if (!v.terms)
        errors.terms =
            "Please select the agreement checkbox to continue with the preview.";
    return errors;
}

export function focusFirstError(
    prefix: string,
    errors: Record<string, string | undefined>,
) {
    const key = Object.keys(errors)[0];
    if (key)
        window.requestAnimationFrame(() =>
            document.getElementById(`${prefix}-${key}`)?.focus(),
        );
}
