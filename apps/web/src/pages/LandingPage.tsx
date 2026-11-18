import { loginDestination } from "../types/auth";
import { reservationApi } from "../services/ReservationApi";
import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";

import { useNavigate } from "react-router";

import MakeReservationButton from "../components/MakeReservationButton";

type IconName =
    | "arrow"
    | "home"
    | "people"
    | "clock"
    | "shield"
    | "check"
    | "sparkle"
    | "menu"
    | "close"
    | "user"
    | "chevron"
    | "calendar"
    | "reservations"
    | "dashboard"
    | "logout";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

type AccountUser = { id: number | string; name: string; email: string; role: string | null };
type AccountStatus = "loading" | "ready" | "error";

async function getSessionUser(signal: AbortSignal): Promise<AccountUser | null> {
    const response = await fetch(`${apiBaseUrl}/auth/user`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error("Unable to check your account.");

    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("user" in data)) {
        throw new Error("Invalid account response.");
    }
    const user = data.user;
    if (!user || typeof user !== "object" ||
        !("id" in user) || !("name" in user) || !("email" in user) ||
        (typeof user.id !== "number" && typeof user.id !== "string") ||
        typeof user.name !== "string" || typeof user.email !== "string") {
        throw new Error("Invalid account response.");
    }
    return { id: user.id, name: user.name, email: user.email, role: "role" in user && typeof user.role === "string" ? user.role : null };
}

async function endSession(): Promise<void> {
    const csrf = await fetch(`${apiBaseUrl}/sanctum/csrf-cookie`, {
        credentials: "include",
        headers: { Accept: "application/json" },
    });
    if (!csrf.ok) throw new Error("Unable to initialize logout.");

    const cookie = document.cookie.split("; ").find(
        (item) => item.startsWith("XSRF-TOKEN="),
    );
    if (!cookie) throw new Error("Missing logout cookie.");

    const response = await fetch(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
            Accept: "application/json",
            "X-XSRF-TOKEN": decodeURIComponent(
                cookie.substring("XSRF-TOKEN=".length),
            ),
        },
    });
    if (!response.ok && response.status !== 401) {
        throw new Error("Logout failed.");
    }
}

const navigation = [
    ["home", "Home"],
    ["about", "About"],
    ["amenities", "Amenities"],
    ["rates", "Rates"],
    ["policies", "Policies"],
    ["location", "Location"],
    ["contact", "Contact"],
];

const slides = [
    {
        src: "/assets/Receiving%20Area.jpg",
        alt: "Receiving and living area at Carlos Paradise",
        label: "Living Area",
    },
    {
        src: "/assets/villa-pool.jpg",
        alt: "Private swimming pool at Carlos Paradise",
        label: "Pool View",
    },
    {
        src: "/assets/villa-dining.jpg",
        alt: "Dining table prepared for a shared meal",
        label: "Dining Table",
    },
    {
        src: "/assets/Master%20Bedroom.jpg",
        alt: "First-floor master bedroom",
        label: "Master Bedroom",
    },
    {
        src: "/assets/Common%20Room.jpg",
        alt: "Second-floor common sleeping room",
        label: "Common Room",
    },
    {
        src: "/assets/villa-lounge.jpg",
        alt: "Entertainment lounge at Carlos Paradise",
        label: "Entertainment Lounge",
    },
    {
        src: "/assets/villa-exterior.jpg",
        alt: "Carlos Paradise villa and pool at dusk",
        label: "Villa Exterior",
    },
    {
        src: "/assets/villa-living.jpg",
        alt: "Shared living space inside the villa",
        label: "Shared Living Space",
    },
];
const amenities = [
    {
        title: "Private Swimming Pool",
        description: "Reserved exclusively for your group.",
    },
    {
        title: "KTV and Billiards",
        description: "Music and games for shared downtime.",
    },
    {
        title: "Kitchen and Dining",
        description: "Prepare and enjoy group meals together.",
    },
    {
        title: "Bonfire Area",
        description: "Wood bundle optional at ₱400.",
    },
    {
        title: "Pet-Friendly",
        description: "Pets are welcome and must wear diapers.",
    },
    {
        title: "On-Site Parking",
        description: "Driveway plus rear parking.",
    },
];
const rates = [
    ["Mon–Thu", "₱16,000"],
    ["Fri–Sat", "₱22,000"],
    ["Sunday", "₱18,000"],
    ["Peak dates — Dec 24, 25, 31 and Jan 1", "₱22,000"],
    ["Holiday surcharge — when applicable", "+₱2,000"],
];

const reservationNotes = [
    "20 chargeable guests are included in each standard price.",
    "Each extra chargeable guest is ₱500, subject to approved maximum occupancy.",
    "Children aged 7 and below are excluded from the pricing headcount.",
    "A ₱5,000 reservation deposit is required.",
    "A ₱3,000 refundable security deposit is paid at check-in.",
    "The remaining balance is paid at check-in.",
    "Check-in is at 2:00 PM; check-out is at 11:00 AM the next day.",
];
const policies: {
    title: string;
    rules: string[];
}[] = [
    {
        title: "Arrival & Payment",
        rules: [
            "Check-in is at 2:00 PM; check-out is at 11:00 AM the next day.",
            "The remaining balance and the ₱3,000 refundable security deposit are paid at check-in.",
            "The refundable security deposit is subject to post-stay inspection.",
        ],
    },
    {
        title: "Changes & Cancellations",
        rules: [
            "Cancellations made one month before check-in receive a 100% refund.",
            "Cancellations made three weeks before check-in receive a 50% refund.",
            "Cancellations made two weeks or less before check-in receive no refund.",
            "Date changes should be requested three weeks ahead.",
            "A ₱2,000 penalty may apply for date changes requested within two weeks of check-in.",
        ],
    },
    {
        title: "Guests & Accommodations",
        rules: [
            "The master bedroom includes two towels; all other guests should bring their own.",
            "For events with more than 30 attendees, a ₱1,000 extra cleaning fee may apply, subject to booking approval.",
        ],
    },
    {
        title: "Pets & Optional Extras",
        rules: [
            "Pets must wear diapers.",
            "A bonfire wood bundle is available for ₱400.",
            "Charcoal is available for ₱30.",
        ],
    },
];
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
    const icons: Record<IconName, ReactNode> = {
        arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,

        home: (
            <>
                <path d="m3 11 9-8 9 8" />
                <path d="M5 10v11h14V10M9 21v-7h6v7" />
            </>
        ),

        people: (
            <>
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </>
        ),

        clock: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </>
        ),

        shield: (
            <>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                <path d="m9 12 2 2 4-4" />
            </>
        ),

        check: <path d="m5 12 4 4L19 6" />,

        sparkle: (
            <path d="m12 3-1.4 4.1L6.5 8.5l4.1 1.4L12 14l1.4-4.1 4.1-1.4-4.1-1.4L12 3ZM5 15l-.7 2.3L2 18l2.3.7L5 21l.7-2.3L8 18l-2.3-.7L5 15Z" />
        ),

        menu: <path d="M4 7h16M4 12h16M4 17h16" />,

        close: <path d="M18 6 6 18M6 6l12 12" />,

        user: (
            <>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
            </>
        ),

        chevron: <path d="m7 10 5 5 5-5" />,

        calendar: (
            <>
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18M9 15h6" />
            </>
        ),

        reservations: (
            <>
                <path d="M6 3h12a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2V5a2 2 0 0 1 2-2Z" />
                <path d="M9 8h6M9 12h6" />
            </>
        ),

        dashboard: (
            <>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
            </>
        ),

        logout: (
            <>
                <path d="M10 17l5-5-5-5M15 12H3" />
                <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
            </>
        ),
    };

    return (
        <svg
            className="shrink-0"
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

function Button({
    children,
    onClick,
    variant = "primary",
    tone = "default",
}: {
    children: ReactNode;
    onClick?: () => void;
    variant?: "primary" | "secondary";
    tone?: "default" | "header" | "hero";
}) {
    const colors =
        tone === "header"
            ? variant === "secondary"
                ? "border-paper bg-paper text-brown"
                : "border-sage bg-sage text-white"
            : tone === "hero"
                ? variant === "secondary"
                    ? "border-white/50 bg-transparent text-white"
                    : "border-paper bg-paper text-brown shadow-[0_8px_20px_rgba(22,16,11,.25)]"
                : variant === "secondary"
                    ? "border-line bg-paper text-brown"
                    : "border-brown bg-brown text-white shadow-[0_8px_20px_rgba(76,52,37,.18)]";
    const size =
        tone === "header"
            ? "min-h-10 px-[15px] text-[11px]"
            : "min-h-[46px] px-5 text-sm";
    return (
        <button
            type="button"
            onClick={onClick}
            className={`inline-flex cursor-pointer items-center justify-center gap-2.5 border font-bold transition duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transform-none motion-reduce:transition-none ${tone === "hero" ? "rounded-full" : "rounded-[10px]"} ${colors} ${size}`}
        >
            {children}
        </button>
    );
}

function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        block: "start",
    });
}


function Logo({ light = false }: { light?: boolean }) {
    return (
        <button
            type="button"
            onClick={() => scrollToSection("home")}
            aria-label="Carlos Paradise home"
            className={`inline-flex shrink-0 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold ${light ? "text-white" : "text-brown"}`}
        >
            <span className="grid size-[38px] shrink-0 place-items-center overflow-hidden rounded-full border-2 border-current bg-paper">
                <img
                    src="/assets/carlos-paradise-logo.jpg"
                    alt=""
                    className="size-full object-cover"
                />
            </span>
            <span className="flex flex-col leading-none">
                <b className="font-display text-[17px] font-normal">Carlos</b>
                <strong className="mt-1 text-[11px] font-bold uppercase tracking-[.15em]">
                    Paradise
                </strong>
            </span>
        </button>
    );
}

export default function LandingPage() {
    const navigateTo = useNavigate();
    const [publicSettings, setPublicSettings] = useState<Record<string, unknown>>({});
    useEffect(() => {
        const controller = new AbortController();
        void reservationApi<{ settings: Record<string, unknown> }>("/settings", "GET", undefined, controller.signal)
            .then(data => { if (!controller.signal.aborted) setPublicSettings(data.settings); })
            .catch(() => { /* The established resort content remains available if configuration cannot load. */ });
        return () => controller.abort();
    }, []);
    const content = (key: string) => typeof publicSettings[key] === "string" ? publicSettings[key] as string : "";
    const lines = (key: string) => content(key).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const amount = (key: string) => `₱${Number(publicSettings[key] ?? 0).toLocaleString("en-PH")}`;
    const displayedAmenities = content("amenities") ? lines("amenities").map(title => ({ title, description: "" })) : amenities;
    const displayedPolicies = content("policies") ? [{ title: "Resort Policies", rules: lines("policies") }] : policies;
    const displayedRates = publicSettings.weekday_rate !== undefined ? [
        ["Mon–Thu", amount("weekday_rate")], ["Fri–Sat", amount("friday_saturday_rate")], ["Sunday", amount("sunday_rate")],
        ["Peak dates", amount("special_rate")], ["Holiday surcharge — when applicable", `+${amount("holiday_surcharge")}`],
    ] : rates;
    const displayedNotes = publicSettings.deposit !== undefined ? [
        `${publicSettings.standard_guests} chargeable guests are included in each standard price.`,
        `Each extra chargeable guest is ${amount("extra_guest_fee")}, up to ${publicSettings.max_guests} guests.`,
        `A ${amount("deposit")} reservation deposit is required.`,
        `A ${amount("security_deposit")} refundable security deposit is paid at check-in.`,
        `Check-in: ${content("check_in_time")}; check-out: ${content("check_out_time")} the next day.`,
        ...lines("inclusions"),
    ] : reservationNotes;
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useState("home");

    const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
    const [accountStatus, setAccountStatus] = useState<AccountStatus>("loading");
    const [accountOpen, setAccountOpen] = useState(false);
    const [accountRetry, setAccountRetry] = useState(0);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const accountPanelRef = useRef<HTMLDivElement>(null);
    const accountButtonRef = useRef<HTMLButtonElement>(null);
    const accountMenuRef = useRef<HTMLDivElement>(null);
    const sessionRequestRef = useRef<AbortController | null>(null);
    const isLoggingOutRef = useRef(false);
    const mountedRef = useRef(false);

    // Laravel's session is the source of truth; nothing is read from localStorage.
    useEffect(() => {
        mountedRef.current = true;
        let active = true;

        async function refreshAccount() {
            if (isLoggingOutRef.current) return;
            sessionRequestRef.current?.abort();
            const controller = new AbortController();
            sessionRequestRef.current = controller;
            try {
                const user = await getSessionUser(controller.signal);
                if (!active || controller.signal.aborted) return;
                if (user && ["admin", "owner"].includes(user.role ?? "")) {
                    navigateTo(loginDestination(user), { replace: true });
                    return;
                }
                setAccountUser(user);
                setAccountStatus("ready");
                if (!user) setAccountOpen(false);
            } catch {
                if (!active || controller.signal.aborted) return;
                setAccountStatus("error");
                setAccountOpen(false);
            }
        }

        void refreshAccount();
        window.addEventListener("focus", refreshAccount);
        return () => {
            active = false;
            mountedRef.current = false;
            sessionRequestRef.current?.abort();
            window.removeEventListener("focus", refreshAccount);
        };
    }, [accountRetry]);

    useEffect(() => {
        if (!accountOpen) return;
        function closeOutside(event: PointerEvent) {
            if (event.target instanceof Node &&
                !accountPanelRef.current?.contains(event.target)) {
                setAccountOpen(false);
            }
        }
        function closeWithEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setAccountOpen(false);
                accountButtonRef.current?.focus();
            }
        }
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("keydown", closeWithEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("keydown", closeWithEscape);
        };
    }, [accountOpen]);

    function focusAccountMenuItem(position: "first" | "last") {
        window.requestAnimationFrame(() => {
            const items = accountMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
            );
            if (!items?.length) return;
            items[position === "first" ? 0 : items.length - 1]?.focus();
        });
    }

    function handleAccountMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        const items = Array.from(
            accountMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
            ) ?? [],
        );
        if (!items.length) return;

        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        let nextIndex: number | null = null;
        if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
        if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = items.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        items[nextIndex]?.focus();
    }

    function openAccountDestination(destination: string) {
        setAccountOpen(false);
        setMenuOpen(false);
        navigateTo(destination);
    }

    async function logout() {
        if (isLoggingOutRef.current) return;
        isLoggingOutRef.current = true;
        setIsLoggingOut(true);
        setLogoutError("");
        // Do not let a stale account check restore the signed-in UI after logout.
        sessionRequestRef.current?.abort();
        try {
            await endSession();
            if (!mountedRef.current) return;
            setAccountUser(null);
            setAccountStatus("ready");
            setAccountOpen(false);
            setMenuOpen(false);
        } catch {
            if (mountedRef.current) {
                setLogoutError("Could not confirm logout. Please try again.");
            }
        } finally {
            isLoggingOutRef.current = false;
            if (mountedRef.current) setIsLoggingOut(false);
        }
    }

    // Track scroll for header background
    const handleScroll = useCallback(() => {
        setScrolled(window.scrollY > 60);

        let currentSection = "home";
        for (const [id] of navigation) {
            const section = document.getElementById(id);
            if (section && section.getBoundingClientRect().top <= 180) {
                currentSection = id;
            }
        }
        setActiveSection(currentSection);
    }, []);

    useEffect(() => {
        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [handleScroll]);

    // Auto-advance the gallery when it is not open in the lightbox.
    useEffect(() => {
        if (galleryOpen) return;

        const timer = window.setInterval(() => {
            setCurrentSlide((slide) => (slide + 1) % slides.length);
        }, 6500);

        return () => window.clearInterval(timer);
    }, [galleryOpen]);

    useEffect(() => {
        if (!galleryOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        function handleGalleryKeydown(event: KeyboardEvent) {
            if (event.key === "Escape") setGalleryOpen(false);
            if (event.key === "ArrowLeft") {
                setCurrentSlide((slide) => (slide - 1 + slides.length) % slides.length);
            }
            if (event.key === "ArrowRight") {
                setCurrentSlide((slide) => (slide + 1) % slides.length);
            }
        }

        document.addEventListener("keydown", handleGalleryKeydown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", handleGalleryKeydown);
        };
    }, [galleryOpen]);
    function openSection(id: string) {
        setMenuOpen(false);
        scrollToSection(id);
    }

    function showSlide(index: number) {
        setCurrentSlide((index + slides.length) % slides.length);
    }

    function login() {
        navigateTo("/login");
    }

    function createAccount() {
        navigateTo("/register");
    }

    return (
        <div className="w-full overflow-x-clip bg-cream font-sans text-sm text-ink">
            <header
                className={`sticky top-0 z-40 flex h-[80px] w-full items-center border-b border-[#493b30] bg-[#33291f] px-[max(3vw,24px)] text-white transition-shadow max-[760px]:h-[68px] max-[760px]:px-[18px] ${scrolled ? "shadow-[0_10px_30px_rgba(25,18,13,.22)]" : "shadow-none"}`}
            >
                <div className="relative mx-auto flex h-full w-full max-w-[1480px] items-center justify-between gap-4">
                    <Logo light />

                    <nav
                        className="hidden items-center gap-1 rounded-full border border-[#51443a] bg-[#2b231d] p-1 min-[1101px]:flex"
                        aria-label="Main navigation"
                    >
                        {navigation.map(([id, label]) => {
                            const isActive = activeSection === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => openSection(id)}
                                    aria-current={isActive ? "page" : undefined}
                                    className={`relative cursor-pointer rounded-full border-0 px-3 py-2 text-[11px] font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-gold ${isActive
                                        ? "bg-[#5a514b] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
                                        : "bg-transparent text-[#d7cabf] hover:bg-white/[.07] hover:text-white"
                                        }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="ml-auto flex shrink-0 items-center gap-2 min-[1101px]:ml-0">
                        {accountStatus === "loading" ? (
                            <span role="status" className="grid size-11 place-items-center">
                                <span aria-hidden="true"
                                    className="size-10 animate-pulse rounded-full bg-white/10 motion-reduce:animate-none" />
                                <span className="sr-only">Checking your account</span>
                            </span>
                        ) : accountStatus === "error" ? (
                            <button type="button"
                                onClick={() => {
                                    setAccountStatus("loading");
                                    setAccountRetry((value) => value + 1);
                                }}
                                title="Account status is unavailable. Retry the session check."
                                className="min-h-11 cursor-pointer rounded-lg border border-white/20 px-3 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-gold">
                                Retry account
                            </button>
                        ) : accountUser ? (
                            <div ref={accountPanelRef} className="relative">
                                <button
                                    type="button"
                                    ref={accountButtonRef}
                                    aria-label={`Account menu for ${accountUser.name}`}
                                    aria-haspopup="menu"
                                    aria-expanded={accountOpen}
                                    aria-controls="landing-account-panel"
                                    title={accountUser.name}
                                    onClick={() => {
                                        setMenuOpen(false);
                                        setLogoutError("");
                                        setAccountOpen((open) => !open);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                                        event.preventDefault();
                                        setMenuOpen(false);
                                        setAccountOpen(true);
                                        focusAccountMenuItem(event.key === "ArrowDown" ? "first" : "last");
                                    }}
                                    className="inline-flex min-h-11 max-w-[210px] cursor-pointer items-center gap-2 rounded-full border border-[#e3d9cb] bg-paper px-3 text-brown shadow-[0_3px_10px_rgba(25,18,13,.08)] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold max-[430px]:max-w-[145px]"
                                >
                                    <Icon name="user" size={21} />
                                    <span className="min-w-0 flex-1 truncate text-xs font-bold">
                                        {accountUser.name}
                                    </span>
                                    <span
                                        className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${accountOpen ? "rotate-180" : ""}`}
                                    >
                                        <Icon name="chevron" size={16} />
                                    </span>
                                </button>
                                {accountOpen && (
                                    <div
                                        id="landing-account-panel"
                                        ref={accountMenuRef}
                                        role="menu"
                                        aria-label="Guest account navigation"
                                        onKeyDown={handleAccountMenuKeyDown}
                                        className="absolute right-0 top-[calc(100%+12px)] z-[60] max-h-[calc(100svh-100px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-[#e3d9cb] bg-[#fffdf8] p-2.5 text-ink shadow-[0_18px_50px_rgba(25,18,13,.2)] max-[1100px]:fixed max-[1100px]:right-3 max-[760px]:top-[76px] min-[761px]:max-[1100px]:top-[88px]"
                                    >
                                        <div className="px-3 pb-3 pt-2">
                                            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-muted">
                                                Signed in as
                                            </p>
                                            <p className="mt-1 truncate text-sm font-bold text-brown">
                                                {accountUser.name}
                                            </p>
                                            <p className="mt-0.5 text-xs text-muted">Guest</p>
                                        </div>

                                        <div className="border-t border-[#e3d9cb] pt-2">
                                            {([
                                                ["Dashboard", "dashboard", "/dashboard"],
                                                ["Make a Reservation", "calendar", "/make-reservation"],
                                                ["My Reservations", "reservations", "/dashboard?view=reservations"],
                                                ["Profile", "user", "/dashboard?view=profile"],
                                            ] as const).map(([label, icon, destination]) => (
                                                <button
                                                    key={label}
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={() => openAccountDestination(destination)}
                                                    className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-brown transition hover:bg-[#f3ecdf] focus-visible:bg-[#f3ecdf] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold"
                                                >
                                                    <Icon name={icon} size={19} />
                                                    <span>{label}</span>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="mt-2 border-t border-[#e3d9cb] pt-2">
                                            <button
                                                type="button"
                                                role="menuitem"
                                                disabled={isLoggingOut}
                                                onClick={() => void logout()}
                                                className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm font-bold text-brown transition hover:bg-[#f3ecdf] focus-visible:bg-[#f3ecdf] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold disabled:cursor-wait disabled:opacity-60"
                                            >
                                                <Icon name="logout" size={19} />
                                                <span>{isLoggingOut ? "Signing out…" : "Sign Out"}</span>
                                            </button>
                                            {logoutError && (
                                                <p role="alert" className="px-3 pb-1 pt-2 text-xs text-[#a44b45]">
                                                    {logoutError}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="hidden items-center gap-2 min-[1101px]:flex">
                                <button
                                    type="button"
                                    onClick={login}
                                    className="inline-flex min-h-[46px] cursor-pointer items-center rounded-[10px] border border-paper bg-paper px-5 text-[11px] font-bold text-brown transition duration-200 hover:-translate-y-px hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transform-none"
                                >
                                    Log In
                                </button>
                                <button
                                    type="button"
                                    onClick={createAccount}
                                    className="inline-flex min-h-[46px] cursor-pointer items-center rounded-[10px] border border-sage bg-sage px-5 text-[11px] font-bold text-white transition duration-200 hover:-translate-y-px hover:bg-[#708577] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transform-none"
                                >
                                    Sign Up
                                </button>
                            </div>

                        )}
                    </div>

                    <button
                        type="button"
                        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/[.06] text-[#e8dfd6] transition hover:bg-white/[.12] hover:text-white focus-visible:outline-2 focus-visible:outline-gold min-[1101px]:hidden"
                        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                        aria-expanded={menuOpen}
                        aria-controls="mobile-public-navigation"
                        onClick={() => {
                            setAccountOpen(false);
                            setMenuOpen((open) => !open);
                        }}
                    >
                        <Icon name={menuOpen ? "close" : "menu"} />
                    </button>

                    {menuOpen && (
                        <div
                            className="absolute inset-x-0 top-[calc(100%+8px)] grid max-h-[calc(100svh-84px)] grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-white/15 bg-[#2d241d]/[.98] p-3 shadow-[0_20px_55px_rgba(25,18,13,.35)] backdrop-blur-xl min-[1101px]:hidden max-[430px]:grid-cols-1 [&>button]:min-h-[44px] [&>button]:cursor-pointer [&>button]:rounded-xl [&>button]:border [&>button]:border-white/10 [&>button]:px-4 [&>button]:text-left [&>button]:font-bold [&>button]:text-[#e8dfd6] [&>button]:transition [&>button:hover]:bg-white/[.08] [&>button:hover]:text-white"
                            id="mobile-public-navigation"
                        >
                            {navigation.map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => openSection(id)}
                                    aria-current={activeSection === id ? "page" : undefined}
                                    className={activeSection === id ? "bg-white/[.1] text-white" : "bg-transparent"}
                                >
                                    {label}
                                </button>
                            ))}

                            {accountStatus === "ready" && !accountUser && (
                                <>
                                    <button type="button" onClick={login}>
                                        Log In
                                    </button>
                                    <button
                                        type="button"
                                        onClick={createAccount}
                                        className="border-sage! bg-sage! text-white!"
                                    >
                                        Sign Up
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </header>

            <main id="home" className="scroll-mt-[80px] max-[760px]:scroll-mt-[68px]">
                {/* ── Hero ── */}
                <section className="relative grid grid-cols-1 grid-rows-[minmax(720px,calc(100svh-80px))_auto] overflow-hidden bg-brown max-[819px]:grid-rows-[minmax(760px,calc(100svh-68px))_auto] after:pointer-events-none after:z-10 after:col-start-1 after:row-start-1 after:bg-[linear-gradient(180deg,rgba(74,50,38,0)_0%,rgba(74,50,38,0)_31%,rgba(74,50,38,.28)_47%,rgba(74,50,38,.82)_68%,#4a3226_84%,#4a3226_100%)] max-[819px]:after:bg-[linear-gradient(180deg,rgba(74,50,38,0)_0%,rgba(74,50,38,0)_30%,rgba(74,50,38,.3)_46%,rgba(74,50,38,.84)_66%,#4a3226_82%,#4a3226_100%)]">
                    <img
                        src="/assets/villa-exterior.jpg"
                        alt="Carlos Paradise private villa and illuminated pool at dusk"
                        fetchPriority="high"
                        className="col-start-1 row-start-1 h-full w-full origin-center object-cover object-[center_48%] animate-hero-breathe motion-reduce:animate-none max-[819px]:object-[center_42%]"
                    />

                    <div className="relative z-20 col-start-1 row-start-1 flex w-full flex-col items-start justify-end px-[max(6vw,64px)] pb-[52px] text-white max-[819px]:px-6 max-[819px]:pb-10">
                        <span className="hidden">Welcome to</span>

                        <h1 className="mb-3 font-display text-[clamp(3.2rem,6vw,5.6rem)] font-normal leading-[1.04] tracking-[-.035em] max-[819px]:text-[43px]">
                            {content("landing_title") || content("name") || "Carlos Paradise"}
                        </h1>
                        <h2 className="mb-[38px] font-display text-[clamp(1.4rem,2.5vw,2.1rem)] font-normal leading-normal text-sand max-[819px]:mb-8">
                            {content("landing_description") || "Private Villa and Resort"}
                        </h2>

                        <blockquote className="m-0 max-w-[620px] font-sans text-[clamp(1rem,1.8vw,1.25rem)] leading-[1.7] text-[#f4eadb] max-[819px]:text-base max-[819px]:leading-[1.75]">
                            &ldquo;Ain&apos;t your ordinary villa!
                            <br />
                            No stress, just memories that will fill ya.&rdquo;
                        </blockquote>

                        <div className="mt-[38px] mb-[30px] flex gap-3 max-[819px]:mt-[34px] max-[819px]:mb-7 max-[760px]:w-full max-[760px]:flex-col">
                            <MakeReservationButton tone="hero">
                                Make a reservation <Icon name="arrow" />
                            </MakeReservationButton>

                            <Button
                                tone="hero"
                                variant="secondary"
                                onClick={() => openSection("about")}
                            >
                                Explore the villa
                            </Button>
                        </div>

                        <small className="flex items-center gap-2 text-[#d7cabf]">
                            <Icon name="shield" size={17} />
                            One private villa, reserved exclusively for your group.
                        </small>
                    </div>

                    <div className="relative z-20 col-start-1 row-start-2 border-b border-line bg-paper">
                        <div className="mx-auto grid min-h-[70px] max-w-[1720px] grid-cols-3 px-[max(4vw,32px)] max-[819px]:grid-cols-1 max-[819px]:px-6 max-[819px]:py-2">
                            <div className="flex min-w-0 items-center gap-3 px-6 text-sm font-semibold leading-5 text-ink max-[819px]:min-h-[52px] max-[819px]:px-0 [&_svg]:shrink-0 [&_svg]:text-gold">
                                <Icon name="home" size={18} />
                                <span>One private villa — exclusive use</span>
                            </div>

                            <div className="relative flex min-w-0 items-center gap-3 px-6 text-sm font-semibold leading-5 text-ink before:absolute before:top-1/2 before:left-0 before:h-7 before:w-px before:-translate-y-1/2 before:bg-line max-[819px]:min-h-[52px] max-[819px]:px-0 max-[819px]:before:top-0 max-[819px]:before:h-px max-[819px]:before:w-full max-[819px]:before:translate-y-0 [&_svg]:shrink-0 [&_svg]:text-gold">
                                <Icon name="people" size={18} />
                                <span>20 guests included — additional guests have an additional charge</span>
                            </div>

                            <div className="relative flex min-w-0 items-center gap-3 px-6 text-sm font-semibold leading-5 text-ink before:absolute before:top-1/2 before:left-0 before:h-7 before:w-px before:-translate-y-1/2 before:bg-line max-[819px]:min-h-[52px] max-[819px]:px-0 max-[819px]:before:top-0 max-[819px]:before:h-px max-[819px]:before:w-full max-[819px]:before:translate-y-0 [&_svg]:shrink-0 [&_svg]:text-gold">
                                <Icon name="clock" size={18} />
                                <span>21-hour overnight stay — 2:00 PM to 11:00 AM</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Villa Gallery ── */}
                {/* ── About & Villa Gallery ── */}
                <section
                    className="scroll-mt-[76px] bg-[#eee9df] px-[max(7vw,28px)] py-[100px] max-[760px]:px-[18px] max-[760px]:py-[60px]"
                    id="about"
                >
                    <div className="mx-auto max-w-[1280px]">
                        <div className="grid gap-10 min-[960px]:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] min-[960px]:gap-[clamp(64px,8vw,128px)]">
                            <div>
                                <span className="mb-4 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                                    About Carlos Paradise
                                </span>

                                <h2 className="max-w-[560px] font-display text-[clamp(2.25rem,4.2vw,4rem)] font-normal leading-[1.04] tracking-[-.04em] text-ink">
                                    <span className="min-[1100px]:block">Slow days. Warm</span>{" "}
                                    <span className="min-[1100px]:block">nights. Better</span>{" "}
                                    <span className="min-[1100px]:block">memories together.</span>
                                </h2>
                            </div>

                            <div className="min-[960px]:pt-9">
                                <p className="m-0 max-w-[660px] text-base leading-[1.8] text-muted">
                                    {content("description") || <>Carlos Paradise welcomes families, friends, and groups to their own
                                    private getaway in Bustos, Bulacan. Spend time together by the pool,
                                    prepare shared meals, sing the night away, or simply unwind. The
                                    property is exclusively reserved for your group.</>}
                                </p>

                                <div className="mt-8 flex flex-col gap-[18px]">
                                    <div className="flex flex-wrap items-baseline gap-x-11 gap-y-[18px]">
                                        <div className="inline-flex w-fit items-baseline gap-2">
                                            <strong className="font-display text-[23px] font-normal leading-none text-brown">
                                                2
                                            </strong>
                                            <span className="text-sm leading-5 text-muted">
                                                floors
                                            </span>
                                        </div>

                                        <div className="inline-flex w-fit items-baseline gap-2">
                                            <strong className="font-display text-[23px] font-normal leading-none text-brown">
                                                21
                                            </strong>
                                            <span className="text-sm leading-5 text-muted">
                                                hours per overnight stay
                                            </span>
                                        </div>
                                    </div>

                                    <div className="inline-flex w-fit items-baseline gap-2">
                                        <strong className="font-display text-[23px] font-normal leading-none text-brown">
                                            30
                                        </strong>
                                        <span className="text-sm leading-5 text-muted">
                                            sleeping spaces with beds and mattresses
                                        </span>
                                    </div>
                                </div>

                                <p className="mt-5 mb-0 max-w-[590px] text-[13px] leading-5 text-muted">
                                    Approved booking capacity remains subject to owner rules.
                                </p>
                            </div>
                        </div>

                        <div className="mt-12">
                            <div className="relative aspect-[16/9] max-h-[720px] min-h-[440px] overflow-hidden bg-brown max-[760px]:min-h-[300px]">
                                <button
                                    type="button"
                                    className="group h-full w-full cursor-zoom-in border-0 bg-transparent p-0 text-left"
                                    aria-label={"Open " + slides[currentSlide].label + " in fullscreen"}
                                    onClick={() => setGalleryOpen(true)}
                                >
                                    <img
                                        key={currentSlide}
                                        src={slides[currentSlide].src}
                                        alt={slides[currentSlide].alt}
                                        loading="lazy"
                                        className="h-full w-full object-cover animate-slide-reveal transition-transform duration-500 group-hover:scale-[1.01] motion-reduce:animate-none motion-reduce:transition-none"
                                    />

                                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[#33291f]/95 px-[22px] py-[18px] text-white max-[760px]:px-[15px] max-[760px]:py-[13px]">
                                        <span className="font-display text-xl max-[760px]:text-base">
                                            {slides[currentSlide].label}
                                        </span>
                                        <b className="text-[11px] tracking-[.1em] text-[#d8c8b9]">
                                            {currentSlide + 1} / {slides.length}
                                        </b>
                                    </span>

                                    <span className="absolute top-4 right-4 rounded-full border border-white/40 bg-[#33291f]/80 px-4 py-2 text-xs font-bold text-white shadow-lg transition group-hover:bg-[#33291f]">
                                        View fullscreen
                                    </span>
                                </button>
                            </div>

                            <div className="mt-3.5 grid grid-cols-[auto_1fr_auto] items-center gap-4 [&>button]:min-w-[120px] max-[760px]:grid-cols-2 max-[760px]:[&>button]:min-w-0">
                                <Button
                                    variant="secondary"
                                    onClick={() => showSlide(currentSlide - 1)}
                                >
                                    ← Previous
                                </Button>

                                <div
                                    className="flex min-w-0 justify-center gap-2 max-[760px]:col-span-2 max-[760px]:row-start-1 max-[760px]:justify-start max-[760px]:overflow-x-auto max-[760px]:p-0.5 [&_img]:size-full [&_img]:rounded-[3px] [&_img]:object-cover"
                                    aria-label="Choose a villa image"
                                >
                                    {slides.map((slide, index) => (
                                        <button
                                            key={slide.src}
                                            type="button"
                                            className={"h-[50px] w-[72px] shrink-0 cursor-pointer overflow-hidden rounded-md border-2 bg-paper p-[3px] transition duration-200 hover:-translate-y-0.5 hover:border-gold hover:opacity-100 motion-reduce:transform-none max-[760px]:h-[42px] max-[760px]:w-[58px] " + (currentSlide === index ? "-translate-y-0.5 border-gold opacity-100" : "border-transparent opacity-[.66]")}
                                            aria-label={"Show " + slide.label}
                                            aria-pressed={currentSlide === index}
                                            onClick={() => showSlide(index)}
                                        >
                                            <img src={slide.src} alt="" loading="lazy" />
                                        </button>
                                    ))}
                                </div>

                                <Button
                                    variant="secondary"
                                    onClick={() => showSlide(currentSlide + 1)}
                                >
                                    Next →
                                </Button>
                            </div>
                        </div>

                        <div className="mt-16 grid grid-cols-2 gap-8 max-[819px]:grid-cols-1">
                            <article className="overflow-hidden border border-line bg-paper">
                                <img
                                    src="/assets/Master%20Bedroom.jpg"
                                    alt="Master bedroom on the first floor"
                                    loading="lazy"
                                    className="aspect-[16/10] w-full object-cover"
                                />
                                <div className="p-6">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-gold">
                                        First floor
                                    </p>
                                    <h3 className="mt-2 font-display text-2xl font-normal text-ink">
                                        Master Bedroom
                                    </h3>
                                    <p className="mt-3 leading-[1.7] text-muted">
                                        Queen bed, pull-out, and extra mattresses; approximately
                                        3–5 guests.
                                    </p>
                                </div>
                            </article>

                            <article className="overflow-hidden border border-line bg-paper">
                                <img
                                    src="/assets/Common%20Room.jpg"
                                    alt="Common room on the second floor"
                                    loading="lazy"
                                    className="aspect-[16/10] w-full object-cover"
                                />
                                <div className="p-6">
                                    <p className="text-[11px] font-extrabold uppercase tracking-[.14em] text-gold">
                                        Second floor
                                    </p>
                                    <h3 className="mt-2 font-display text-2xl font-normal text-ink">
                                        Common Room
                                    </h3>
                                    <p className="mt-3 leading-[1.7] text-muted">
                                        Bunk beds for 12 and seven extra double-size mattresses.
                                    </p>
                                </div>
                            </article>
                        </div>
                    </div>

                    {galleryOpen && (
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-label="Villa photo gallery"
                            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#17120f]/95 p-4 sm:p-8"
                            onMouseDown={(event) => {
                                if (event.target === event.currentTarget) setGalleryOpen(false);
                            }}
                        >
                            <button
                                type="button"
                                autoFocus
                                aria-label="Close fullscreen gallery"
                                onClick={() => setGalleryOpen(false)}
                                className="absolute top-4 right-4 z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-white/30 bg-black/40 text-white transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-gold"
                            >
                                <Icon name="close" size={22} />
                            </button>

                            <button
                                type="button"
                                aria-label="Previous image"
                                onClick={() => showSlide(currentSlide - 1)}
                                className="absolute left-3 z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-white/30 bg-black/40 text-xl text-white transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-gold sm:left-6"
                            >
                                ←
                            </button>

                            <figure className="m-0 flex max-h-full max-w-[1440px] flex-col items-center">
                                <img
                                    src={slides[currentSlide].src}
                                    alt={slides[currentSlide].alt}
                                    className="max-h-[calc(100vh-110px)] max-w-full object-contain"
                                />
                                <figcaption className="mt-3 text-center text-sm font-semibold text-white">
                                    {slides[currentSlide].label}
                                    <span className="ml-3 font-normal text-white/60">
                                        {currentSlide + 1} / {slides.length}
                                    </span>
                                </figcaption>
                            </figure>

                            <button
                                type="button"
                                aria-label="Next image"
                                onClick={() => showSlide(currentSlide + 1)}
                                className="absolute right-3 z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-white/30 bg-black/40 text-xl text-white transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-gold sm:right-6"
                            >
                                →
                            </button>
                        </div>
                    )}
                </section>
                <section
                    className="grid scroll-mt-[76px] grid-cols-2 items-center gap-[7vw] border-t border-line bg-paper px-[max(8vw,35px)] py-[100px] [&>div]:max-w-[580px] [&>img]:h-[470px] [&>img]:w-full [&>img]:object-cover max-[819px]:grid-cols-1 max-[819px]:gap-[35px] max-[819px]:px-[22px] max-[819px]:py-[60px] max-[819px]:[&>img]:h-[330px]"
                    id="amenities"
                >
                    <div>
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Amenities & Experiences
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Everything for a relaxed private stay.
                        </h2>

                        <p className="mb-[1em] text-muted leading-[1.75]">
                            Enjoy practical comforts and shared spaces throughout your
                            exclusive stay.
                        </p>

                        <div className="mt-6 grid grid-cols-2 border-t border-line max-[520px]:grid-cols-1">
                            {displayedAmenities.map((amenity) => (
                                <div
                                    key={amenity.title}
                                    className="flex items-start gap-3 border-b border-line py-4 pr-5 odd:mr-5 max-[520px]:mr-0 max-[520px]:pr-0 [&_svg]:shrink-0 [&_svg]:text-sage"
                                >
                                    <Icon name="check" size={18} />
                                    <span>
                                        <b className="block font-semibold text-ink">
                                            {amenity.title}
                                        </b>
                                        <small className="mt-1 block text-[13px] leading-5 text-muted">
                                            {amenity.description}
                                        </small>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <img
                        src="/assets/villa-pool.jpg"
                        alt="Carlos Paradise private pool"
                        loading="lazy"
                    />
                </section>

                {/* ── Rates & Reservation ── */}
                <section className="grid grid-cols-2 gap-[9vw] border-y border-[#ded6ca] bg-[#eee9df] px-[max(9vw,40px)] py-[95px] max-[819px]:grid-cols-1 max-[819px]:gap-[50px] max-[819px]:px-[22px] max-[819px]:py-[60px]">
                    <div className="scroll-mt-[90px]" id="rates">
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Rates
                        </span>
                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Simple, clear pricing.
                        </h2>

                        <div className="mt-5 flex flex-col">
                            {displayedRates.map(([label, price]) => (
                                <div
                                    key={label}
                                    className="flex items-start justify-between gap-6 border-b border-[#d7cfc3] py-[13px]"
                                >
                                    <span className="leading-6 text-ink">{label}</span>
                                    <b className="shrink-0 text-right leading-6 text-brown">
                                        {price}
                                    </b>
                                </div>
                            ))}
                        </div>

                        <p className="mt-4 mb-0 text-xs leading-5 text-muted">
                            The holiday surcharge is never added to an already-applicable
                            ₱22,000 peak rate.
                        </p>
                    </div>

                    <div className="scroll-mt-[90px]">
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Reservation Information
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            A few things to know.
                        </h2>

                        <ul className="mt-5 mb-0 list-none p-0">
                            {displayedNotes.map((note) => (
                                <li
                                    key={note}
                                    className="flex gap-3 border-b border-[#d7cfc3] py-3 leading-6 text-muted [&_svg]:mt-1 [&_svg]:shrink-0 [&_svg]:text-sage"
                                >
                                    <Icon name="check" size={17} />
                                    <span>{note}</span>
                                </li>
                            ))}
                        </ul>

                        <p className="mt-4 text-xs leading-5 text-muted">
                            The booking backend is the source of truth for final amounts and
                            approved occupancy.
                        </p>

                        <MakeReservationButton className="mt-6 inline-flex items-center justify-center gap-3 rounded-xl bg-brown px-6 py-3 font-semibold text-white transition hover:bg-[#6e4b35] disabled:opacity-50">
                            Reserve Your Dates <Icon name="arrow" size={17} />
                        </MakeReservationButton>
                    </div>
                </section>
                <section
                    className="scroll-mt-[76px] bg-sage-pale px-[max(9vw,40px)] py-[90px] max-[760px]:px-[22px] max-[760px]:py-[60px]"
                    id="policies"
                >
                    <div className="mx-auto max-w-[1280px]">
                        <div className="grid grid-cols-2 items-start gap-[clamp(56px,8vw,120px)] max-[819px]:grid-cols-1 max-[819px]:gap-5">
                            <div>
                                <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                                    House Rules & Policies
                                </span>
                                <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                                    Clear details before your stay.
                                </h2>
                            </div>

                            <p className="m-0 max-w-[600px] leading-6 text-muted min-[820px]:pt-8">
                                Everything important is in one place. Open a topic below to read
                                the full policy without leaving the page.
                            </p>
                        </div>

                        <div className="mt-10 grid grid-cols-2 items-start gap-4 max-[760px]:grid-cols-1">
                            {displayedPolicies.map((policy) => (
                                <details
                                    key={policy.title}
                                    className="group rounded-[10px] border border-line bg-paper"
                                >
                                    <summary className="flex min-h-[81px] cursor-pointer list-none items-center justify-between gap-5 rounded-[10px] px-5 py-4 marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
                                        <span className="font-semibold text-ink">
                                            {policy.title}
                                        </span>
                                        <span
                                            aria-hidden="true"
                                            className="shrink-0 text-xl leading-none text-gold transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
                                        >
                                            ›
                                        </span>
                                    </summary>

                                    <ul className="mx-5 mt-0 mb-5 list-disc border-t border-line pt-4 pl-5 text-[13px] leading-6 text-muted marker:text-gold">
                                        {policy.rules.map((rule) => (
                                            <li key={rule} className="mb-2 last:mb-0">
                                                {rule}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            ))}
                        </div>
                    </div>
                </section>
                <section className="grid scroll-mt-[76px] grid-cols-[1fr_1.15fr] border-b border-line bg-paper max-[819px]:grid-cols-1">
                    <div
                        className="grid scroll-mt-[76px] grid-cols-[190px_1fr] items-center gap-7 border-r border-line bg-paper px-[max(5vw,40px)] py-20 [&_h2]:mb-2 [&_h2]:text-[28px] [&_button]:mt-3 max-[1200px]:grid-cols-1 max-[819px]:border-r-0 max-[819px]:border-b max-[819px]:px-[22px] max-[819px]:py-7"
                        id="location"
                    >
                        <div
                            className="relative grid h-[230px] place-items-center overflow-hidden rounded-lg border border-[#d4ded3] bg-sage-pale before:absolute before:h-px before:w-[150%] before:rotate-[35deg] before:bg-[#c9d4c8] after:absolute after:h-px after:w-[150%] after:-rotate-45 after:bg-[#c9d4c8] max-[819px]:h-[190px] [&>span]:z-10 [&>span]:grid [&>span]:size-[58px] [&>span]:-rotate-45 [&>span]:place-items-center [&>span]:rounded-[50%_50%_50%_0] [&>span]:bg-brown [&>span]:text-white [&>span]:shadow-[0_18px_50px_rgba(63,47,33,.09)] [&_svg]:rotate-45"
                            aria-hidden="true"
                        >
                            <span>
                                <Icon name="home" size={28} />
                            </span>
                        </div>

                        <div>
                            <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                                Location
                            </span>
                            <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                                Find Carlos Paradise.
                            </h2>

                            <p className="mb-[1em] text-muted leading-[1.75]">
                                <b>Carlos Paradise Private Villa and Resort</b>
                                <br />
                                731 NIA Road, Brgy. Malamig, Bustos, Bulacan
                            </p>

                            <Button
                                onClick={() =>
                                    window.open(
                                        "https://www.google.com/maps/search/?api=1&query=731+NIA+Road+Brgy+Malamig+Bustos+Bulacan",
                                        "_blank",
                                        "noopener,noreferrer",
                                    )
                                }
                            >
                                Get Directions <Icon name="arrow" />
                            </Button>
                        </div>
                    </div>

                    <div
                        className="scroll-mt-[76px] bg-cream px-[max(5vw,40px)] py-20 [&>h2]:mb-2 [&>h2]:text-[28px] max-[819px]:px-[22px] max-[819px]:py-7"
                        id="contact"
                    >
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Contact Information
                        </span>
                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Let&apos;s plan your stay.
                        </h2>
                        <p className="mb-[1em] text-muted leading-[1.75]">
                            {content("name") || "Carlos Paradise Private Villa and Resort"}
                        </p>

                        {content("contact") && <p className="text-muted whitespace-pre-line">{content("contact")}</p>}
                        {content("address") && <p className="text-muted whitespace-pre-line">{content("address")}</p>}

                        <div className="mt-[25px] flex flex-col gap-[7px] [&>button]:flex [&>button]:cursor-pointer [&>button]:justify-between [&>button]:gap-[18px] [&>button]:rounded-lg [&>button]:border [&>button]:border-line [&>button]:bg-paper [&>button]:px-3.5 [&>button]:py-[13px] [&>button]:text-left [&>button]:text-ink [&>button]:transition [&>button:hover]:translate-x-[3px] [&>button:hover]:border-gold [&_span]:text-[10px] [&_span]:text-muted [&_b]:text-right [&_b]:text-[11px] [&_b]:wrap-anywhere">
                            <button
                                type="button"
                                onClick={() =>
                                    window.open(
                                        "https://wa.me/639430969626",
                                        "_blank",
                                        "noopener,noreferrer",
                                    )
                                }
                            >
                                <span>Mobile / WhatsApp</span>
                                <b>+63 943 096 9626</b>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    window.open(
                                        "https://www.facebook.com/",
                                        "_blank",
                                        "noopener,noreferrer",
                                    )
                                }
                            >
                                <span>Facebook</span>
                                <b>Carlos Paradise Private Villa and Resort</b>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    window.open(
                                        "https://www.instagram.com/carlosparadisevilla",
                                        "_blank",
                                        "noopener,noreferrer",
                                    )
                                }
                            >
                                <span>Instagram</span>
                                <b>@CarlosParadiseVilla</b>
                            </button>

                            <button
                                type="button"
                                onClick={() =>
                                    window.open(
                                        "https://www.tiktok.com/@carlosparadise",
                                        "_blank",
                                        "noopener,noreferrer",
                                    )
                                }
                            >
                                <span>TikTok</span>
                                <b>@carlosparadise</b>
                            </button>
                        </div>
                    </div>
                </section>

                {/* ── CTA Band ── */}
                <section className="flex min-h-[280px] items-center justify-between gap-[35px] bg-brown px-[max(8vw,35px)] py-[70px] text-white [&>div]:max-w-[850px] [&_h2]:mb-2 [&_h2]:max-w-[820px] [&_h2]:text-[clamp(1.7rem,3vw,2.8rem)] [&_p]:mb-0 [&_p]:text-[#d8c8b9] max-[819px]:flex-col max-[819px]:items-start max-[819px]:gap-[22px] max-[819px]:px-[25px] max-[819px]:py-[45px]">
                    <div>
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-[#ead7b7]">
                            Ready to make memories?
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            &ldquo;Ain&apos;t your ordinary villa! No stress, just memories
                            that will fill ya!&rdquo;
                        </h2>

                        <p className="mb-[1em] text-muted leading-[1.75]">
                            Tell us your preferred dates and we&apos;ll guide you through the
                            reservation process.
                        </p>
                    </div>

                    <button
                        type="button"
                        className="flex min-h-[46px] shrink-0 cursor-pointer items-center gap-[9px] rounded-[9px] border border-[#6d5948] bg-[#403429] px-[18px] font-bold text-[#f8f2ea] transition-colors hover:bg-paper hover:text-brown max-[430px]:w-full max-[430px]:justify-center"
                        onClick={() => openSection("home")}
                    >
                        Back to the villa overview
                        <Icon name="arrow" />
                    </button>
                </section>
            </main>
        </div>
    );
}
