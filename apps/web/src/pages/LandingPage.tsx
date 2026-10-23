import { useEffect, useState, useCallback, type ReactNode } from "react";
import "./LandingPage.css";

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

function Icon({
    name,
    size = 20,
}: {
    name: IconName;
    size?: number;
}) {
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
}: {
    children: ReactNode;
    onClick?: () => void;
    variant?: "primary" | "secondary";
}) {
    return (
        <button
            type="button"
            className={`btn btn-${variant} cp-button ${variant === "secondary" ? "cp-button-outline" : ""}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

function navigate(path: string) {
    window.location.assign(path);
}

function Logo({ light = false }: { light?: boolean }) {
    return (
        <button
            type="button"
            className={`logo cp-brand ${light ? "logo-light" : ""}`}
            onClick={() => scrollToSection("home")}
            aria-label="Carlos Paradise home"
        >
            <span className="logo-mark">
                <img src="/assets/carlos-paradise-logo.jpg" alt="" />
            </span>

            <span>
                <b>Carlos</b>
                <strong>Paradise</strong>
            </span>
        </button>
    );
}

export default function LandingPage() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [scrolled, setScrolled] = useState(false);

    // Track scroll for header background
    const handleScroll = useCallback(() => {
        setScrolled(window.scrollY > 60);
    }, []);

    useEffect(() => {
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

    function createAccount() {
        navigate("/register");
    }

    function viewVilla() {
        navigate("/villa");
    }

    return (
        <div className="public-page cp-page">
            <header
                className={`public-header cp-header cp-header-inner ${scrolled ? "scrolled" : ""} ${menuOpen ? "menu-open" : ""}`}
            >
                <Logo light />

                <nav className="cp-navigation" aria-label="Main navigation">
                    {navigation.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => openSection(id)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>

                <div className="header-actions cp-header-actions">
                    <Button variant="secondary" onClick={createAccount}>
                        Sign Up
                    </Button>

                    <Button onClick={createAccount}>
                        Create Account
                    </Button>
                </div>

                <button
                    type="button"
                    className="mobile-menu cp-menu-button"
                    aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                    aria-expanded={menuOpen}
                    aria-controls="mobile-public-navigation"
                    onClick={() => setMenuOpen((open) => !open)}
                >
                    <Icon name={menuOpen ? "close" : "menu"} />
                </button>

                {menuOpen && (
                    <div
                        className="mobile-public-nav"
                        id="mobile-public-navigation"
                    >
                        {navigation.map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => openSection(id)}
                            >
                                {label}
                            </button>
                        ))}

                        <Button variant="secondary" onClick={createAccount}>
                            Sign Up
                        </Button>

                        <Button onClick={createAccount}>
                            Create Account
                        </Button>
                    </div>
                )}
            </header>

            <main id="home">
                {/* ── Hero ── */}
                <section className="hero cp-hero">
                    <img
                        src="/assets/villa-exterior.jpg"
                        alt="Carlos Paradise private villa and illuminated pool at dusk"
                        fetchPriority="high"
                        className="cp-hero-image"
                    />

                    <div className="hero-content cp-hero-content cp-container">
                        <span className="eyebrow light">Welcome to</span>

                        <h1>Carlos Paradise</h1>
                        <h2 className="cp-hero-subtitle">Private Villa and Resort</h2>

                        <blockquote>
                            &ldquo;Ain&apos;t your ordinary villa!
                            <br />
                            No stress, just memories that will fill ya.&rdquo;
                        </blockquote>

                        <div className="hero-buttons cp-button-group">
                            <Button onClick={createAccount}>
                                Make a reservation <Icon name="arrow" />
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={() => openSection("villa-gallery")}
                            >
                                Explore the villa
                            </Button>
                        </div>

                        <small>
                            <Icon name="shield" size={17} />
                            One private villa, reserved exclusively for your group.
                        </small>
                    </div>

                    <div className="hero-facts cp-highlights cp-container">
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
                <section className="villa-showcase cp-section cp-container" id="villa-gallery">
                    <div className="section-heading cp-section-heading">
                        <span className="eyebrow">Villa Gallery</span>

                        <h2>One private escape, many ways to unwind.</h2>

                        <p>
                            Take a closer look at the spaces your group can enjoy
                            exclusively.
                        </p>
                    </div>

                    <div className="slideshow-frame cp-gallery">
                        <img
                            key={currentSlide}
                            src={slides[currentSlide].src}
                            alt={slides[currentSlide].alt}
                            loading="lazy"
                        />

                        <div className="slide-caption">
                            <span>{slides[currentSlide].label}</span>

                            <b>
                                {currentSlide + 1} / {slides.length}
                            </b>
                        </div>
                    </div>

                    <div className="slideshow-controls cp-gallery-controls">
                        <Button
                            variant="secondary"
                            onClick={() => showSlide(currentSlide - 1)}
                        >
                            ← Previous
                        </Button>

                        <div
                            className="slide-dots cp-gallery-dots"
                            aria-label="Choose a villa image"
                        >
                            {slides.map((slide, index) => (
                                <button
                                    key={slide.src}
                                    type="button"
                                    className={currentSlide === index ? "active is-active" : ""}
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
                <section className="intro cp-about cp-section cp-container" id="about">
                    <div>
                        <span className="eyebrow">About Carlos Paradise</span>

                        <h2>
                            Slow days. Warm nights.
                            <br />
                            Your people, together.
                        </h2>
                    </div>

                    <div>
                        <p>
                            A thoughtfully designed private villa where celebrations
                            feel intimate and weekends feel longer. From the pool at
                            twilight to relaxed meals around the table, every space
                            is yours to enjoy.
                        </p>

                        <button
                            type="button"
                            className="text-link cp-text-link"
                            onClick={viewVilla}
                        >
                            Discover the private villa
                            <Icon name="arrow" size={17} />
                        </button>
                    </div>
                </section>

                {/* ── Amenities ── */}
                <section className="landing-amenities cp-amenities cp-section cp-container" id="amenities">
                    <div>
                        <span className="eyebrow">Amenities & Experiences</span>

                        <h2>Everything for an effortless private stay.</h2>

                        <p>
                            Enjoy the whole villa exclusively with your group, with
                            spaces designed for comfort, connection, and celebration.
                        </p>

                        <div className="landing-amenity-list cp-amenity-list">
                            {amenities.map((amenity) => (
                                <span key={amenity}>
                                    <Icon name="check" />
                                    {amenity}
                                </span>
                            ))}
                        </div>

                        <Button onClick={viewVilla}>
                            Explore All Amenities
                        </Button>
                    </div>

                    <img
                        src="/assets/villa-pool.jpg"
                        alt="Carlos Paradise private pool"
                        loading="lazy"
                    />
                </section>

                {/* ── Rates & Reservation ── */}
                <section className="landing-rates-policies cp-rate-grid cp-section cp-container">
                    <div className="cp-card" id="rates">
                        <span className="eyebrow">Rates</span>
                        <h2>Simple, clear pricing.</h2>

                        <div className="landing-rate-list cp-rate-list">
                            {rates.map(([label, price]) => (
                                <span key={label}>
                                    {label}
                                    <b>{price}</b>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="reservation-information cp-card cp-process">
                        <span className="eyebrow">
                            Reservation Information
                        </span>

                        <h2>A fair, guided process.</h2>

                        <p>
                            Submit your preferred check-in and check-out dates.
                            We&apos;ll review availability and notify you when your
                            reservation opportunity becomes active.
                        </p>

                        <button
                            type="button"
                            className="text-link cp-text-link"
                            onClick={viewVilla}
                        >
                            Review reservation details
                            <Icon name="arrow" size={17} />
                        </button>
                    </div>
                </section>

                {/* ── Policies ── */}
                <section className="landing-policies cp-section cp-container" id="policies">
                    <div>
                        <span className="eyebrow">Policies</span>
                        <h2>Clear details before your stay.</h2>
                    </div>

                    <div className="policy-highlights cp-policy-grid">
                        {policies.map((policy) => (
                            <span key={policy.title}>
                                <Icon name={policy.icon} />
                                <b>{policy.title}</b>
                                <small>{policy.description}</small>
                            </span>
                        ))}
                    </div>

                    <Button variant="secondary" onClick={viewVilla}>
                        View Full Policies
                    </Button>
                </section>

                {/* ── Contact & Location ── */}
                <section className="contact-location cp-contact-grid cp-section cp-container">
                    <div className="location-panel cp-location" id="location">
                        <div className="map-visual" aria-hidden="true">
                            <span>
                                <Icon name="home" size={28} />
                            </span>
                        </div>

                        <div>
                            <span className="eyebrow">Location</span>
                            <h2>Find Carlos Paradise.</h2>

                            <p>
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

                    <div className="contact-panel cp-card" id="contact">
                        <span className="eyebrow">Contact Information</span>
                        <h2>Let&apos;s plan your stay.</h2>
                        <p>Carlos Paradise Private Villa and Resort</p>

                        <div className="contact-links cp-contact-links">
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
                <section className="cta-band cp-cta cp-container">
                    <div>
                        <span className="eyebrow light">
                            Ready to make memories?
                        </span>

                        <h2>
                            &ldquo;Ain&apos;t your ordinary villa! No stress, just memories
                            that will fill ya!&rdquo;
                        </h2>

                        <p>
                            Tell us your preferred dates and we&apos;ll guide you
                            through the reservation process.
                        </p>
                    </div>

                    <button
                        type="button"
                        className="cta-text-link"
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
