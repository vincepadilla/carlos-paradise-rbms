import { useState, type InputHTMLAttributes, type ReactNode } from "react";

const inputStyle =
    "min-h-[47px] w-full rounded-lg border bg-white px-[13px] font-medium text-ink outline-none transition focus:border-gold focus:ring-[3px] focus:ring-gold/15 disabled:opacity-60";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
    id: string;
    label: string;
    error?: string;
    hint?: string;
};

export function Field({ id, label, error, hint, ...props }: FieldProps) {
    return (
        <div className="mb-[17px]">
            <label htmlFor={id} className="mb-2 block text-xs font-bold">
                {label}
            </label>
            <input
                {...props}
                id={id}
                aria-invalid={Boolean(error)}
                aria-describedby={
                    error ? `${id}-error` : hint ? `${id}-hint` : undefined
                }
                className={`${inputStyle} ${error ? "border-[#a44b45]" : "border-line"}`}
            />
            {hint && !error && (
                <p
                    id={`${id}-hint`}
                    className="mt-1.5 text-xs leading-relaxed text-muted"
                >
                    {hint}
                </p>
            )}
            {error && (
                <p
                    id={`${id}-error`}
                    role="alert"
                    className="mt-1.5 text-xs text-[#a44b45]"
                >
                    {error}
                </p>
            )}
        </div>
    );
}

export function PasswordField({
    id,
    label,
    error,
    hint,
    ...props
}: Omit<FieldProps, "type">) {
    const [visible, setVisible] = useState(false);
    return (
        <div className="mb-[17px]">
            <label htmlFor={id} className="mb-2 block text-xs font-bold">
                {label}
            </label>
            <div className="relative">
                <input
                    {...props}
                    id={id}
                    type={visible ? "text" : "password"}
                    aria-invalid={Boolean(error)}
                    aria-describedby={
                        error ? `${id}-error` : hint ? `${id}-hint` : undefined
                    }
                    className={`${inputStyle} pr-[70px] ${error ? "border-[#a44b45]" : "border-line"}`}
                />
                <button
                    type="button"
                    aria-controls={id}
                    aria-pressed={visible}
                    aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
                    onClick={() => setVisible((v) => !v)}
                    className="absolute inset-y-0 right-0 cursor-pointer rounded-r-lg px-3 text-xs font-bold text-brown focus-visible:outline-2 focus-visible:outline-gold"
                >
                    {visible ? "Hide" : "Show"}
                </button>
            </div>
            {hint && !error && (
                <p
                    id={`${id}-hint`}
                    className="mt-1.5 text-xs leading-relaxed text-muted"
                >
                    {hint}
                </p>
            )}
            {error && (
                <p
                    id={`${id}-error`}
                    role="alert"
                    className="mt-1.5 text-xs text-[#a44b45]"
                >
                    {error}
                </p>
            )}
        </div>
    );
}

export function AuthButton({
    children,
    type = "button",
    onClick,
    secondary = false,
}: {
    children: ReactNode;
    type?: "button" | "submit";
    onClick?: () => void;
    secondary?: boolean;
}) {
    return (
        <button
            type={type}
            onClick={onClick}
            className={`inline-flex min-h-[46px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-[10px] border px-5 font-bold transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transform-none ${secondary ? "border-line bg-paper text-brown" : "border-brown bg-brown text-white shadow-[0_8px_20px_rgba(76,52,37,.18)]"}`}
        >
            {children}
        </button>
    );
}

export function AuthHeading({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <>
            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                {eyebrow}
            </span>
            <h1 className="mb-2.5 font-display text-[38px] font-normal leading-[1.12] tracking-[-.035em] max-[430px]:text-[32px]">
                {title}
            </h1>
            <p className="leading-[1.75] text-muted">{description}</p>
        </>
    );
}

export function PreviewNotice() {
    return (
        <p className="mt-6 rounded-lg border border-line bg-cream p-3 text-xs leading-relaxed text-muted">
            Frontend preview only. No account is created, no email is sent, and
            signing in is not connected to Laravel yet.
        </p>
    );
}
