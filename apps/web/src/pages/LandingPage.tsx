import { useEffect, useState, useCallback, type ReactNode } from "react";

import { useNavigate } from "react-router";

type IconName =
    | "arrow"
    | "home"
    | "people"
    | "clock"
    | "shield"
    | "check"
    | "sparkle"
    | "menu"
    | "close";

const navigation = [
    ["home", "Home"],
    ["about", "About"],
    ["villa-gallery", "Villa"],
    ["amenities", "Amenities"],
    ["rates", "Rates"],
    ["policies", "Policies"],
    ["location", "Location"],
    ["contact", "Contact"],
];

const slides = [
    {
        src: "/assets/villa-exterior.jpg",
        alt: "Carlos Paradise private villa and pool at dusk",
        label: "The villa at twilight",
    },
    {
        src: "/assets/villa-pool.jpg",
        alt: "Private swimming pool and covered patio",
        label: "Your private pool",
    },
    {
        src: "/assets/villa-living.jpg",
        alt: "Warm and comfortable villa living area",
        label: "Space to slow down",
    },
    {
        src: "/assets/villa-dining.jpg",
        alt: "Spacious dining area for shared meals",
        label: "Gather around the table",
    },
    {
        src: "/assets/villa-lounge.jpg",
        alt: "Entertainment lounge inside the private villa",
        label: "Relax, play, reconnect",
    },
];

const amenities = [
    "Private swimming pool",
    "Entertainment lounge",
    "Equipped kitchen",
    "On-site parking",
    "Pet-friendly stay",
    "Spacious dining area",
];

const rates = [
    ["Monday–Thursday", "₱16,000"],
    ["Friday–Saturday", "₱22,000"],
    ["Sunday", "₱18,000"],
    ["Public holiday surcharge", "+₱2,000"],
];

const policies: {
    icon: IconName;
    title: string;
    description: string;
}[] = [
        {
            icon: "clock",
            title: "Arrival & departure",
            description: "Check-in at 2:00 PM · Check-out at 11:00 AM",
        },
        {
            icon: "people",
            title: "Guest pricing",
            description: "20 guests standard · additional guest rates apply",
        },
        {
            icon: "sparkle",
            title: "Pet-friendly",
            description: "Pets are welcome and must wear diapers.",
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
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [scrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useState("home");

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

    // Auto-advance slideshow
    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentSlide((slide) => (slide + 1) % slides.length);
        }, 6500);

        return () => window.clearInterval(timer);
    }, []);

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

    function viewVilla() {
        navigateTo("/villa");
    }

    function viewAmenities() {
        navigateTo("/villa#amenities");
    }

    function viewPolicies() {
        navigateTo("/villa#policies");
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
                                    className={`relative cursor-pointer rounded-full border-0 px-3 py-2 text-[11px] font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-gold ${
                                        isActive
                                            ? "bg-[#5a514b] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
                                            : "bg-transparent text-[#d7cabf] hover:bg-white/[.07] hover:text-white"
                                    }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </nav>

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

                    <button
                        type="button"
                        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/[.06] text-[#e8dfd6] transition hover:bg-white/[.12] hover:text-white focus-visible:outline-2 focus-visible:outline-gold min-[1101px]:hidden"
                        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                        aria-expanded={menuOpen}
                        aria-controls="mobile-public-navigation"
                        onClick={() => setMenuOpen((open) => !open)}
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
                            Carlos Paradise
                        </h1>
                        <h2 className="mb-[38px] font-display text-[clamp(1.4rem,2.5vw,2.1rem)] font-normal leading-normal text-sand max-[819px]:mb-8">
                            Private Villa and Resort
                        </h2>

                        <blockquote className="m-0 max-w-[620px] font-sans text-[clamp(1rem,1.8vw,1.25rem)] leading-[1.7] text-[#f4eadb] max-[819px]:text-base max-[819px]:leading-[1.75]">
                            &ldquo;Ain&apos;t your ordinary villa!
                            <br />
                            No stress, just memories that will fill ya.&rdquo;
                        </blockquote>

                        <div className="mt-[38px] mb-[30px] flex gap-3 max-[819px]:mt-[34px] max-[819px]:mb-7 max-[760px]:w-full max-[760px]:flex-col">
                            <Button tone="hero" onClick={createAccount}>
                                Make a reservation <Icon name="arrow" />
                            </Button>

                            <Button
                                tone="hero"
                                variant="secondary"
                                onClick={() => openSection("villa-gallery")}
                            >
                                Explore the villa
                            </Button>
                        </div>

                        <small className="flex items-center gap-2 text-[#d7cabf]">
                            <Icon name="shield" size={17} />
                            One private villa, reserved exclusively for your group.
                        </small>
                    </div>

                    <div className="relative z-20 col-start-1 row-start-2 grid grid-cols-3 border-b border-line bg-paper px-[max(7vw,50px)] py-7 max-[819px]:grid-cols-1 max-[819px]:px-6 max-[819px]:py-[18px] [&>div]:flex [&>div]:gap-3.5 [&>div]:border-r [&>div]:border-line [&>div]:px-6 [&>div:last-child]:border-0 max-[819px]:[&>div]:border-r-0 max-[819px]:[&>div]:border-b max-[819px]:[&>div]:px-0 max-[819px]:[&>div]:py-2.5 [&_svg]:text-gold [&_span]:flex [&_span]:flex-col [&_span]:font-bold [&_small]:mt-[5px] [&_small]:font-normal [&_small]:text-muted">
                        <div>
                            <Icon name="home" />

                            <span>
                                One private villa
                                <small>Exclusive for your group</small>
                            </span>
                        </div>

                        <div>
                            <Icon name="people" />

                            <span>
                                Flexible group planning
                                <small>Additional guest pricing available</small>
                            </span>
                        </div>

                        <div>
                            <Icon name="clock" />

                            <span>
                                2:00 PM arrival
                                <small>11:00 AM departure</small>
                            </span>
                        </div>
                    </div>
                </section>

                {/* ── Villa Gallery ── */}
                <section
                    className="scroll-mt-[76px] bg-[#eee9df] px-[max(7vw,28px)] py-[100px] max-[760px]:px-[18px] max-[760px]:py-[60px]"
                    id="villa-gallery"
                >
                    <div className="mb-[34px] max-w-[680px] [&>h2]:mb-2.5 [&>p]:mb-0">
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Villa Gallery
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            One private escape, many ways to unwind.
                        </h2>

                        <p className="mb-[1em] text-muted leading-[1.75]">
                            Take a closer look at the spaces your group can enjoy exclusively.
                        </p>
                    </div>

                    <div className="relative mx-auto h-[min(68vw,720px)] min-h-[440px] max-w-[1280px] overflow-hidden bg-brown max-[760px]:h-[65vw] max-[760px]:min-h-[330px] [&>img]:h-full [&>img]:w-full [&>img]:object-cover [&>img]:animate-slide-reveal motion-reduce:[&>img]:animate-none">
                        <img
                            key={currentSlide}
                            src={slides[currentSlide].src}
                            alt={slides[currentSlide].alt}
                            loading="lazy"
                        />

                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-[#33291f] px-[22px] py-[18px] text-white max-[760px]:px-[15px] max-[760px]:py-[13px] [&>span]:font-display [&>span]:text-xl max-[760px]:[&>span]:text-base [&>b]:text-[11px] [&>b]:tracking-[.1em] [&>b]:text-[#d8c8b9]">
                            <span>{slides[currentSlide].label}</span>

                            <b>
                                {currentSlide + 1} / {slides.length}
                            </b>
                        </div>
                    </div>

                    <div className="mx-auto mt-3.5 grid max-w-[1280px] grid-cols-[auto_1fr_auto] items-center gap-4 [&>button]:min-w-[120px] max-[760px]:grid-cols-2 max-[760px]:[&>button]:min-w-0">
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
                                    className={`h-[50px] w-[72px] shrink-0 cursor-pointer overflow-hidden rounded-md border-2 bg-paper p-[3px] transition duration-200 hover:-translate-y-0.5 hover:border-gold hover:opacity-100 motion-reduce:transform-none max-[760px]:h-[42px] max-[760px]:w-[58px] ${currentSlide === index ? "-translate-y-0.5 border-gold opacity-100" : "border-transparent opacity-[.66]"}`}
                                    aria-label={`Show image ${index + 1}`}
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
                </section>

                {/* ── About ── */}
                <section
                    className="grid scroll-mt-[76px] grid-cols-[1.1fr_.9fr] items-end gap-[100px] bg-paper px-[max(9vw,40px)] py-[100px] [&_p]:text-base max-[819px]:grid-cols-1 max-[819px]:gap-[25px] max-[819px]:px-[22px] max-[819px]:py-[65px]"
                    id="about"
                >
                    <div>
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            About Carlos Paradise
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Slow days. Warm nights.
                            <br />
                            Your people, together.
                        </h2>
                    </div>

                    <div>
                        <p className="mb-[1em] text-muted leading-[1.75]">
                            A thoughtfully designed private villa where celebrations feel
                            intimate and weekends feel longer. From the pool at twilight to
                            relaxed meals around the table, every space is yours to enjoy.
                        </p>

                        <button
                            type="button"
                            className="flex cursor-pointer items-center gap-2 border-0 border-b border-brown bg-transparent pb-[7px] font-semibold text-ink transition-colors hover:text-gold"
                            onClick={viewVilla}
                        >
                            Discover the private villa
                            <Icon name="arrow" size={17} />
                        </button>
                    </div>
                </section>

                {/* ── Amenities ── */}
                <section
                    className="grid scroll-mt-[76px] grid-cols-2 items-center gap-[7vw] border-t border-line bg-paper px-[max(8vw,35px)] py-[100px] [&>div]:max-w-[580px] [&>img]:h-[470px] [&>img]:w-full [&>img]:object-cover max-[819px]:grid-cols-1 max-[819px]:gap-[35px] max-[819px]:px-[22px] max-[819px]:py-[60px] max-[819px]:[&>img]:h-[330px]"
                    id="amenities"
                >
                    <div>
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Amenities & Experiences
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Everything for an effortless private stay.
                        </h2>

                        <p className="mb-[1em] text-muted leading-[1.75]">
                            Enjoy the whole villa exclusively with your group, with spaces
                            designed for comfort, connection, and celebration.
                        </p>

                        <div className="mt-[25px] mb-[30px] grid grid-cols-2 border-t border-line max-[819px]:grid-cols-1 [&>span]:flex [&>span]:items-center [&>span]:gap-[9px] [&>span]:border-b [&>span]:border-line [&>span]:py-3.5 [&>span]:font-semibold [&_svg]:text-sage">
                            {amenities.map((amenity) => (
                                <span key={amenity}>
                                    <Icon name="check" />
                                    {amenity}
                                </span>
                            ))}
                        </div>

                        <Button onClick={viewAmenities}>Explore All Amenities</Button>
                    </div>

                    <img
                        src="/assets/villa-pool.jpg"
                        alt="Carlos Paradise private pool"
                        loading="lazy"
                    />
                </section>

                {/* ── Rates & Reservation ── */}
                <section className="grid grid-cols-2 gap-[9vw] border-y border-[#ded6ca] bg-[#eee9df] px-[max(9vw,40px)] py-[95px] max-[819px]:grid-cols-1 max-[819px]:gap-[35px] max-[819px]:px-[22px] max-[819px]:py-[60px]">
                    <div className="scroll-mt-[90px]" id="rates">
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Rates
                        </span>
                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Simple, clear pricing.
                        </h2>

                        <div className="mt-5 flex flex-col [&>span]:flex [&>span]:justify-between [&>span]:gap-5 [&>span]:border-b [&>span]:border-[#d7cfc3] [&>span]:py-[13px] [&_b]:shrink-0">
                            {rates.map(([label, price]) => (
                                <span key={label}>
                                    {label}
                                    <b>{price}</b>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="scroll-mt-[90px]">
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Reservation Information
                        </span>

                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            A fair, guided process.
                        </h2>

                        <p className="mb-[1em] text-muted leading-[1.75]">
                            Submit your preferred check-in and check-out dates. We&apos;ll
                            review availability and notify you when your reservation
                            opportunity becomes active.
                        </p>

                        <button
                            type="button"
                            className="flex cursor-pointer items-center gap-2 border-0 border-b border-brown bg-transparent pb-[7px] font-semibold text-ink transition-colors hover:text-gold"
                            onClick={viewVilla}
                        >
                            Review reservation details
                            <Icon name="arrow" size={17} />
                        </button>
                    </div>
                </section>

                {/* ── Policies ── */}
                <section
                    className="grid scroll-mt-[76px] grid-cols-[.7fr_1.3fr_auto] items-center gap-[50px] bg-sage-pale px-[max(9vw,40px)] py-[90px] max-[1050px]:grid-cols-1 max-[1050px]:gap-[25px] max-[760px]:px-[22px] max-[760px]:py-[60px]"
                    id="policies"
                >
                    <div>
                        <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold">
                            Policies
                        </span>
                        <h2 className="font-display text-[clamp(1.45rem,2.4vw,2.25rem)] font-normal leading-[1.12] tracking-[-.035em]">
                            Clear details before your stay.
                        </h2>
                    </div>

                    <div className="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1 [&>span]:flex [&>span]:min-h-[145px] [&>span]:flex-col [&>span]:gap-2 [&>span]:rounded-[10px] [&>span]:border [&>span]:border-line [&>span]:bg-paper [&>span]:p-5 max-[760px]:[&>span]:min-h-0 [&_svg]:text-sage [&_small]:leading-[1.5] [&_small]:text-muted">
                        {policies.map((policy) => (
                            <span key={policy.title}>
                                <Icon name={policy.icon} />
                                <b>{policy.title}</b>
                                <small>{policy.description}</small>
                            </span>
                        ))}
                    </div>

                    <Button variant="secondary" onClick={viewPolicies}>
                        View Full Policies
                    </Button>
                </section>

                {/* ── Contact & Location ── */}
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
                            Carlos Paradise Private Villa and Resort
                        </p>

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
