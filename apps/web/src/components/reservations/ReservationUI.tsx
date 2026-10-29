import type { ReactNode } from "react";

export type IconName =
    | "arrow"
    | "calendar"
    | "check"
    | "chevron"
    | "clock"
    | "credit"
    | "home"
    | "menu"
    | "people"
    | "search"
    | "shield"
    | "sparkle"
    | "upload";
const icons: Record<IconName, ReactNode> = {
    arrow: (
        <>
            <path d="M5 12h14M13 6l6 6-6 6" />
        </>
    ),
    calendar: (
        <>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18" />
        </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </>
    ),
    credit: (
        <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 10h18M7 15h3" />
        </>
    ),
    home: (
        <>
            <path d="m3 11 9-8 9 8" />
            <path d="M5 10v11h14V10M9 21v-7h6v7" />
        </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    people: (
        <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
    ),
    search: (
        <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
        </>
    ),
    shield: (
        <>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="m9 12 2 2 4-4" />
        </>
    ),
    sparkle: (
        <path d="m12 3-1.4 4.1L6.5 8.5l4.1 1.4L12 14l1.4-4.1 4.1-1.4-4.1-1.4L12 3ZM5 15l-.7 2.3L2 18l2.3.7L5 21l.7-2.3L8 18l-2.3-.7L5 15Z" />
    ),
    upload: (
        <>
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M5 15v5h14v-5" />
        </>
    ),
};
type IconProps = {
    name: IconName;
    size?: number;
};
export function Icon({ name, size = 20 }: IconProps) {
    return (
        <svg
            aria-hidden="true"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {icons[name]}
        </svg>
    );
}
const buttonBase =
    "inline-flex min-h-[46px] items-center justify-center gap-2.5 rounded-[10px] border-0 px-5 text-sm font-bold transition duration-200 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-45";
const buttonVariants = {
    primary:
        "bg-[#4c3425] text-white shadow-[0_8px_20px_rgba(76,52,37,0.18)] hover:bg-[#6e4b35]",
    secondary: "border! border-[#e3d9cb]! bg-[#fffdf8] text-[#4c3425]",
    ghost: "bg-transparent text-[#4c3425]",
    danger: "bg-[#f7e6e3] text-[#a44b45]",
};
export function Button({
    children,
    onClick,
    variant = "primary",
    type = "button",
    className = "",
    disabled = false,
}: {
    children: ReactNode;
    onClick?: () => void;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    type?: "button" | "submit";
    className?: string;
    disabled?: boolean;
}) {
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={[buttonBase, buttonVariants[variant], className]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </button>
    );
}
export function PageHead({
    eyebrow,
    title,
    copy,
    action,
}: {
    eyebrow?: string;
    title: string;
    copy: string;
    action?: ReactNode;
}) {
    return (
        <div className="mb-7 flex items-end justify-between gap-6 [&_h1]:mb-2 [&_h1]:text-[27px] [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.035em] md:[&_h1]:text-[30px] [&_p]:m-0 [&_p]:text-sm">
            <div>
                {eyebrow && (
                    <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#b08a52]">
                        {eyebrow}
                    </span>
                )}
                <h1>{title}</h1>
                <p>{copy}</p>
            </div>
            {action}
        </div>
    );
}
export function GuestCounter({
    label,
    helper,
    value,
    onChange,
}: {
    label: string;
    helper?: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div className="flex min-h-[68px] items-center justify-between gap-[18px] border-b border-[#e3d9cb] px-4 py-3 last:border-0 [&>div:first-child]:flex [&>div:first-child]:flex-col [&>div:first-child]:gap-1 [&_small]:text-[9px] [&_small]:text-[#776f65]">
            <div>
                <b>{label}</b>
                {helper && <small>{helper}</small>}
            </div>
            <div className="grid shrink-0 grid-cols-[32px_38px_32px] items-center text-center [&>button]:size-8 [&>button]:rounded-full [&>button]:border [&>button]:border-[#e3d9cb] [&>button]:bg-[#fffdf8] [&>button]:text-lg [&>button]:leading-none [&>button]:text-[#4c3425] [&>button:hover]:bg-[#f6f1e7]">
                <button
                    type="button"
                    aria-label={`Decrease ${label}`}
                    onClick={() =>
                        onChange(Math.max(label.includes("Adults") ? 1 : 0, value - 1))
                    }
                >
                    −
                </button>
                <strong>{value}</strong>
                <button
                    type="button"
                    aria-label={`Increase ${label}`}
                    onClick={() => onChange(value + 1)}
                >
                    +
                </button>
            </div>
        </div>
    );
}
