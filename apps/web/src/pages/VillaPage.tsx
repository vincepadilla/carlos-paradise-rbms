import { useEffect, useState } from "react";
import { Link } from "react-router";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

type AccountUser = { id: number | string; name: string; email: string };
type AccountStatus = "loading" | "ready" | "error";

const navLinks = [
    ["Home", "/"], ["About", "/#about"], ["Villa", "/villa"],
    ["Amenities", "/villa#amenities"], ["Rates", "/villa#rates"],
    ["Policies", "/villa#policies"], ["Location", "/#location"], ["Contact", "/#contact"],
];

const amenities = [
    "Private swimming pool", "Entertainment lounge", "Fully equipped kitchen",
    "Spacious dining area", "On-site parking", "Pet-friendly stay",
];

const rates = [
    ["Monday–Thursday", "₱16,000"], ["Friday–Saturday", "₱22,000"],
    ["Sunday", "₱18,000"], ["Public holiday surcharge", "+₱2,000"],
    ["Additional guest", "₱500 / person"],
];

const policies = [
    ["Arrival & departure", "Overnight check-in is at 2:00 PM; check-out is at 11:00 AM. Day-tour schedules require Admin or Owner agreement."],
    ["Guest pricing", "Standard pricing covers 20 chargeable guests. Each additional chargeable guest is ₱500. A ₱1,000 cleaning fee applies for 30 or more guests."],
    ["Pets & towels", "Pets must wear diapers at all times. The Master’s Bedroom includes two towels; other guests should bring their own."],
    ["Parking", "Driveway: one van and one SUV. Rear parking: five to six vehicles. Additional vehicles may park in front of the villa."],
    ["Cancellation & refunds", "One month before check-in: 100% refund. Three weeks before check-in: 50% refund. Two weeks or less: no refund."],
    ["Rescheduling", "Request at least three weeks before the reservation. Later requests may not be accommodated. Changes within two weeks incur a ₱2,000 penalty."],
    ["Reservation deposit", "The ₱5,000 reservation deposit is required only when your reservation opportunity begins. Your date is secured after payment verification and reservation approval."],
    ["Security deposit", "A refundable ₱3,000 security deposit is collected at check-in. It is returned after inspection if there are no damages or losses and is separate from the booking estimate."],
];

const heading = "font-display text-[clamp(1.6rem,3vw,2.5rem)] font-normal leading-tight tracking-[-.035em]";
const eyebrow = "mb-3 block text-[11px] font-extrabold uppercase tracking-[.16em] text-gold";
const button = "inline-flex min-h-[46px] items-center justify-center rounded-[10px] bg-brown px-5 text-sm font-bold text-white transition hover:bg-[#6e4b35] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold";

export default function VillaPage() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
    const [accountStatus, setAccountStatus] =
        useState<AccountStatus>("loading");

    useEffect(() => {
        const controller = new AbortController();

        async function loadAccount() {
            try {
                const response = await fetch(`${apiBaseUrl}/auth/user`, {
                    credentials: "include",
                    headers: { Accept: "application/json" },
                    cache: "no-store",
                    signal: controller.signal,
                });

                if (response.status === 401) {
                    setAccountUser(null);
                    setAccountStatus("ready");
                    return;
                }

                if (!response.ok) throw new Error("Account check failed.");

                const data = (await response.json()) as {
                    user?: AccountUser | null;
                };
                setAccountUser(data.user || null);
                setAccountStatus("ready");
            } catch (error) {
                if (controller.signal.aborted) return;
                setAccountStatus("error");
            }
        }

        void loadAccount();
        return () => controller.abort();
    }, []);

    return (
        <div className="min-h-screen bg-cream font-sans text-sm text-ink">
            <header className="sticky top-0 z-40 flex min-h-[76px] items-center justify-between gap-5 border-b border-[#4b3d31] bg-[#33291f] px-[max(3vw,24px)] text-white">
                <Link to="/" aria-label="Carlos Paradise home" className="flex shrink-0 items-center gap-2.5">
                    <img src="/assets/carlos-paradise-logo.jpg" alt="" className="size-[38px] rounded-full border-2 border-white object-cover" />
                    <span className="flex flex-col leading-none">
                        <span className="font-display text-[17px]">Carlos</span>
                        <strong className="mt-1 text-[11px] uppercase tracking-[.15em]">Paradise</strong>
                    </span>
                </Link>

                <nav aria-label="Villa navigation" className="hidden items-center gap-[18px] min-[1101px]:flex">
                    {navLinks.map(([label, path]) => <Link key={label} to={path} className="py-2 text-[11px] font-semibold text-[#e8dfd6] hover:text-white">{label}</Link>)}
                </nav>

                <div className="hidden items-center gap-2 min-[1101px]:flex">
                    {accountStatus === "loading" ? (
                        <span
                            role="status"
                            aria-label="Checking your account"
                            className="size-11 animate-pulse rounded-full bg-white/10"
                        />
                    ) : accountUser ? (
                        <Link
                            to="/dashboard"
                            aria-label={`Open ${accountUser.name}'s dashboard`}
                            title={accountUser.name}
                            className="grid size-11 place-items-center rounded-full border border-paper/30 bg-paper text-brown transition hover:bg-white"
                        >
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="size-[22px]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 21a8 8 0 0 1 16 0" />
                            </svg>
                        </Link>
                    ) : accountStatus === "ready" ? (
                        <>
                            <Link to="/login" className="rounded-[10px] border border-[#5d5147] px-4 py-3 text-[11px] font-bold text-[#e8dfd6] hover:text-white">Login</Link>
                            <Link to="/register" className="rounded-[10px] bg-sage px-4 py-3 text-[11px] font-bold text-ink">Create Account</Link>
                        </>
                    ) : null}
                </div>
                <button type="button" aria-expanded={menuOpen} aria-controls="villa-mobile-menu" onClick={() => setMenuOpen(!menuOpen)} className="cursor-pointer rounded-md border border-white/30 px-3 py-2 min-[1101px]:hidden">{menuOpen ? "Close" : "Menu"}</button>

                {menuOpen && <nav id="villa-mobile-menu" aria-label="Mobile villa navigation" className="absolute inset-x-0 top-full grid max-h-[calc(100svh-76px)] grid-cols-2 gap-2 overflow-y-auto border-t border-white/15 bg-[#33291f] p-4 min-[1101px]:hidden">
                    {navLinks.map(([label, path]) => <Link key={label} to={path} onClick={() => setMenuOpen(false)} className="rounded-lg border border-white/20 px-3 py-3 text-sm">{label}</Link>)}
                    {accountUser ? (
                        <Link to="/dashboard" onClick={() => setMenuOpen(false)} className="col-span-2 rounded-lg bg-sage px-3 py-3 text-center font-bold text-ink">Dashboard</Link>
                    ) : accountStatus === "ready" ? (
                        <>
                            <Link to="/login" onClick={() => setMenuOpen(false)} className="rounded-lg border border-white/20 px-3 py-3 text-center font-bold text-white">Login</Link>
                            <Link to="/register" onClick={() => setMenuOpen(false)} className="rounded-lg bg-sage px-3 py-3 text-center font-bold text-ink">Create Account</Link>
                        </>
                    ) : null}
                </nav>}
            </header>

            <main>
                <section className="relative mx-auto flex min-h-[500px] max-w-[1440px] items-end overflow-hidden px-[max(7vw,40px)] py-[70px] text-white max-[760px]:min-h-[420px] max-[760px]:px-6">
                    <img src="/assets/villa-pool.jpg" alt="Carlos Paradise pool and covered patio" className="absolute inset-0 size-full object-cover" fetchPriority="high" />
                    <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(30,23,18,.8),transparent_75%)]" />
                    <div className="relative z-10 max-w-[700px]">
                        <span className={`${eyebrow} text-[#ead7b7]!`}>The whole villa, just for you</span>
                        <h1 className="font-display text-[clamp(2.8rem,6vw,5rem)] font-normal leading-[1.04] tracking-[-.035em]">A place made for togetherness.</h1>
                    </div>
                </section>

                <section id="overview" className="mx-auto my-[100px] grid max-w-[1100px] scroll-mt-24 grid-cols-2 items-center gap-[100px] px-7 max-[819px]:my-[60px] max-[819px]:grid-cols-1 max-[819px]:gap-6">
                    <div><span className={eyebrow}>About Carlos Paradise</span><h2 className={heading}>Private, spacious, and warmly considered.</h2></div>
                    <p className="text-base leading-[1.75] text-muted">Carlos Paradise gives your group exclusive use of the entire villa. Enjoy generous shared spaces, restful interiors, a private pool, and everything you need for a memorable stay.</p>
                </section>

                <section id="amenities" className="grid scroll-mt-24 grid-cols-2 items-center gap-[8vw] bg-paper px-[max(5vw,30px)] py-[100px] max-[819px]:grid-cols-1 max-[819px]:gap-9 max-[819px]:px-6 max-[819px]:py-[60px]">
                    <div className="grid h-[560px] grid-cols-[1fr_.7fr] gap-3.5 max-[819px]:h-[340px]">
                        <img src="/assets/villa-living.jpg" alt="Comfortable living area" loading="lazy" className="size-full object-cover" />
                        <img src="/assets/villa-dining.jpg" alt="Dining area" loading="lazy" className="h-[70%] w-full self-end object-cover" />
                    </div>
                    <div>
                        <span className={eyebrow}>Villa amenities</span>
                        <h2 className={heading}>Everything in one private retreat.</h2>
                        <ul className="my-[30px] grid grid-cols-2 gap-x-5 max-[430px]:grid-cols-1">
                            {amenities.map(item => <li key={item} className="flex items-center gap-2.5 border-b border-line py-4 font-semibold"><span aria-hidden="true" className="grid size-[25px] shrink-0 place-items-center rounded-full bg-sage-pale text-sage">✓</span>{item}</li>)}
                        </ul>
                        <div className="flex flex-wrap gap-[50px]">
                            <div><strong className="block font-display text-[42px] font-normal text-brown">20</strong><span className="text-muted">Standard capacity</span></div>
                            <div><strong className="block font-display text-[42px] font-normal text-brown">₱500</strong><span className="text-muted">Per additional guest</span></div>
                        </div>
                    </div>
                </section>

                <section id="rates" className="mx-auto my-[100px] grid max-w-[1100px] scroll-mt-24 grid-cols-[.8fr_1.2fr] gap-[100px] px-7 max-[819px]:my-[60px] max-[819px]:grid-cols-1 max-[819px]:gap-6">
                    <div><span className={eyebrow}>Simple, transparent pricing</span><h2 className={heading}>Plan your stay.</h2><p className="mt-5 leading-[1.75] text-muted">Rates are for exclusive use of the entire private villa.</p></div>
                    <dl>{rates.map(([label, price]) => <div key={label} className="flex justify-between gap-5 border-b border-line py-[18px]"><dt>{label}</dt><dd className="shrink-0 font-bold text-brown">{price}</dd></div>)}</dl>
                </section>

                <section id="policies" className="scroll-mt-24 bg-sage-pale px-[max(5vw,24px)] py-20">
                    <div className="mx-auto max-w-[1100px]">
                        <span className={eyebrow}>Reservation policies</span>
                        <h2 className={heading}>Clear details before your stay.</h2>
                        <div className="mt-8 grid grid-cols-2 items-start gap-4 max-[760px]:grid-cols-1">
                            {policies.map(([title, description]) => <details key={title} open className="rounded-xl border border-line bg-paper p-5"><summary className="cursor-pointer font-bold text-brown">{title}</summary><p className="mt-3 leading-[1.75] text-muted">{description}</p></details>)}
                        </div>
                    </div>
                </section>

                <section className="bg-cream px-6 py-[90px] text-center">
                    <h2 className={heading}>Ready to make it yours?</h2>
                    <p className="mx-auto mt-5 mb-7 max-w-[600px] leading-[1.75] text-muted">Tell us your preferred dates. We’ll review your request and keep you updated.</p>
                    <Link to={accountUser ? "/make-reservation" : "/register"} className={button}>Request a Reservation</Link>
                </section>
            </main>
        </div>
    );
}
