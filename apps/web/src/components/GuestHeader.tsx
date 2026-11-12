import { useEffect, useRef, useState } from "react";
import type { User } from "../api";
import { logoutReservationSession } from "../services/ReservationApi";
import { Icon, type IconName } from "./reservations/ReservationUI";

export default function GuestHeader({
    user,
    onReservations,
    onMakeReservation,
    activePage = "request",
    onDashboard,
    onProfile,
}: {
    user: User;
    onReservations?: () => void;
    onMakeReservation?: () => void;
    activePage?: "dashboard" | "request" | "reservations" | "profile";
    onDashboard?: () => void;
    onProfile?: () => void;
}) {
    const activeLabel =
        activePage === "profile"
            ? "Profile"
            : activePage === "dashboard"
                ? "Dashboard"
                : activePage === "reservations"
                    ? "My Reservations"
                    : "Make a Reservation";
    function openPage(label: string) {
        if (label === "Dashboard" && onDashboard) onDashboard();
        else if (label === "Profile" && onProfile) onProfile();
        else if (label === "Make a Reservation") onMakeReservation?.();
        else if (label === "My Reservations") onReservations?.();
        else setNotice(`Open ${label} from the main site navigation.`);
    }
    const [notice, setNotice] = useState("");
    const [menu, setMenu] = useState(false);
    const [accountMenu, setAccountMenu] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const accountRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!accountMenu) return;

        function closeAccountMenu(event: PointerEvent) {
            if (
                event.target instanceof Node &&
                !accountRef.current?.contains(event.target)
            ) {
                setAccountMenu(false);
            }
        }

        function closeWithEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setAccountMenu(false);
        }

        document.addEventListener("pointerdown", closeAccountMenu);
        document.addEventListener("keydown", closeWithEscape);
        return () => {
            document.removeEventListener("pointerdown", closeAccountMenu);
            document.removeEventListener("keydown", closeWithEscape);
        };
    }, [accountMenu]);
    useEffect(() => {
        if (!menu) return;
        function closeMobileMenu(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setMenu(false);
                menuButtonRef.current?.focus();
            }
        }
        document.addEventListener("keydown", closeMobileMenu);
        return () => document.removeEventListener("keydown", closeMobileMenu);
    }, [menu]);
    useEffect(() => {
        const desktop = window.matchMedia("(min-width: 1100px)");
        const closeAtDesktop = (event: MediaQueryListEvent) => { if (event.matches) setMenu(false); };
        desktop.addEventListener("change", closeAtDesktop);
        return () => desktop.removeEventListener("change", closeAtDesktop);
    }, []);

    async function logout() {
        if (loggingOut) return;
        setLoggingOut(true);
        setLogoutError("");

        try {
            await logoutReservationSession();
            window.location.assign("/login");
        } catch {
            setLogoutError("Unable to log out. Please try again.");
            setLoggingOut(false);
        }
    }
    const links: [string, IconName][] = [
        ["Dashboard", "home"],
        ["Make a Reservation", "calendar"],
        ["My Reservations", "credit"],
        ["Profile", "people"],
        ["Help & Support", "sparkle"],
    ];
    return (
        <>
            <header className="sticky top-0 z-30 grid min-h-[78px] w-full max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-visible border-b border-[#e3d9cb] bg-[#fffdf8] px-3 shadow-[0_6px_24px_rgba(63,47,33,0.05)] sm:gap-3 sm:px-4 min-[1100px]:gap-7 min-[1100px]:px-[3vw]">
                <a
                    className="inline-flex items-center gap-2.5 text-left text-[#4c3425] no-underline [&>span:last-child]:flex [&>span:last-child]:flex-col [&>span:last-child]:leading-none [&_b]:font-serif [&_b]:text-[17px] [&_b]:font-normal [&_strong]:mt-1 [&_strong]:text-[11px] [&_strong]:uppercase [&_strong]:tracking-[0.15em]"
                    href="/"
                    aria-label="Carlos Paradise home"
                >
                    <span className="grid size-[38px] shrink-0 place-items-center overflow-hidden rounded-full border border-current [&>img]:size-full [&>img]:object-cover">
                        <img src="/assets/carlos-paradise-logo.jpg" alt="" />
                    </span>
                    <span>
                        <b>Carlos</b>
                        <strong>Paradise</strong>
                    </span>
                </a>
                <nav
                    className="hidden min-w-0 items-center justify-center gap-[3px] min-[1100px]:flex [&>button]:flex [&>button]:min-h-10 [&>button]:items-center [&>button]:gap-1.5 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-[#fffdf8] [&>button]:px-2.5 [&>button]:text-[10px] [&>button]:font-bold [&>button]:whitespace-nowrap [&>button]:text-[#776f65] [&>button:hover]:bg-[#f6f1e7] [&>button:hover]:text-[#4c3425]"
                    aria-label="Guest navigation"
                >
                    {links.map(([label, icon]) => (
                        <button
                            type="button"
                            key={label}
                            className={
                                label === activeLabel ? "bg-[#e8eee5]! text-[#4c3425]!" : ""
                            }
                            aria-current={label === activeLabel ? "page" : undefined}
                            onClick={() => openPage(label)}
                        >
                            <Icon name={icon} size={16} />
                            {label}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="text-[#4c3425]! [&>svg]:rotate-180"
                        onClick={() => window.location.assign("/")}
                    >
                        <Icon name="arrow" size={16} />
                        Main Site
                    </button>
                </nav>
                <div ref={accountRef} className="relative justify-self-end">
                    <button
                        type="button"
                        className="flex items-center gap-[9px] whitespace-nowrap rounded-lg border-0 bg-transparent p-1 text-left text-[#4c3425] hover:bg-[#f6f1e7]"
                        aria-label="Open guest account menu"
                        aria-haspopup="menu"
                        aria-expanded={accountMenu}
                        onClick={() => {
                            setAccountMenu((open) => !open);
                            setLogoutError("");
                        }}
                    >
                        <span className="grid size-9 place-items-center rounded-full bg-[#e8eee5] text-[11px] font-extrabold">
                            {user.name
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((word) => word[0])
                                .join("")}
                        </span>
                        <span className="hidden flex-col text-[10px] sm:flex">
                            <b>{user.name}</b>
                            <small className="text-[#776f65]">Guest</small>
                        </span>
                    </button>
                    {accountMenu && (
                        <div
                            role="menu"
                            className="absolute top-[calc(100%+10px)] right-0 z-50 w-52 rounded-lg border border-[#e3d9cb] bg-[#fffdf8] p-2 shadow-[0_12px_30px_rgba(63,47,33,0.16)]"
                        >
                            <button
                                type="button"
                                role="menuitem"
                                disabled={loggingOut}
                                onClick={() => void logout()}
                                className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-xs font-semibold text-[#a44b45] hover:bg-[#f7e6e3] disabled:cursor-wait disabled:opacity-60"
                            >
                                <Icon name="arrow" size={15} />
                                {loggingOut ? "Logging out..." : "Log out"}
                            </button>
                            {logoutError && (
                                <p
                                    role="alert"
                                    className="m-0 px-3 pt-2 pb-1 text-[10px] leading-relaxed text-[#a44b45]"
                                >
                                    {logoutError}
                                </p>
                            )}
                        </div>
                    )}
                </div>
                <button
                    ref={menuButtonRef}
                    type="button"
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-[#e3d9cb] bg-[#f6f1e7] text-[#4c3425] outline-none hover:bg-[#eee5d8] focus-visible:ring-2 focus-visible:ring-[#b08a52] focus-visible:ring-offset-2 min-[1100px]:hidden"
                    aria-label={menu ? "Close guest navigation" : "Open guest navigation"}
                    aria-expanded={menu}
                    aria-controls="guest-mobile-navigation"
                    onClick={() => { setMenu((open) => !open); setAccountMenu(false); }}
                >
                    <Icon name={menu ? "close" : "menu"} />
                </button>
            </header>
            {menu && (
                <nav
                    id="guest-mobile-navigation"
                    className="relative z-20 grid w-full max-w-full grid-cols-1 gap-1 overflow-x-hidden border-b border-[#e3d9cb] bg-[#fffdf8] p-3 shadow-[0_10px_24px_rgba(63,47,33,0.08)] min-[1100px]:hidden [&>a]:min-h-11 [&>a]:w-full [&>a]:items-center [&>a]:gap-3 [&>a]:rounded-lg [&>a]:px-4 [&>a]:text-sm [&>a]:font-bold [&>a]:text-[#4c3425] [&>a]:no-underline [&>button]:min-h-11 [&>button]:w-full [&>button]:items-center [&>button]:gap-3 [&>button]:rounded-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-4 [&>button]:text-left [&>button]:text-sm [&>button]:font-bold [&>button]:text-[#4c3425] [&>button]:outline-none [&>button:hover]:bg-[#f6f1e7] [&>button:focus-visible]:ring-2 [&>button:focus-visible]:ring-[#b08a52] [&>button:focus-visible]:ring-offset-1"
                    aria-label="Guest navigation"
                >
                    {links.map(([label, icon]) => (
                        <button
                            type="button"
                            key={label}
                            className={`flex ${label === activeLabel ? "bg-[#e8eee5]!" : ""}`}
                            aria-current={label === activeLabel ? "page" : undefined}
                            onClick={() => {
                                setMenu(false);
                                openPage(label);
                            }}
                        >
                            <Icon name={icon} size={18} />
                            {label}
                        </button>
                    ))}
                    <a className="flex outline-none hover:bg-[#f6f1e7] focus-visible:ring-2 focus-visible:ring-[#b08a52] focus-visible:ring-offset-1" href="/" onClick={() => setMenu(false)}>
                        <Icon name="arrow" size={18} />
                        Back to Main Site
                    </a>
                </nav>
            )}
            {notice && (
                <div
                    className="flex items-center justify-between gap-4 bg-[#f6ecd7] px-7 py-2.5 [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-xl"
                    role="status"
                >
                    {notice}
                    <button
                        type="button"
                        aria-label="Dismiss notice"
                        onClick={() => setNotice("")}
                    >
                        ×
                    </button>
                </div>
            )}
        </>
    );
}
