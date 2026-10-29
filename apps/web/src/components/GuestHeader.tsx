import { useState } from "react";
import type { User } from "../api";
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
    const links: [string, IconName][] = [
        ["Dashboard", "home"],
        ["Make a Reservation", "calendar"],
        ["My Reservations", "credit"],
        ["Profile", "people"],
        ["Help & Support", "sparkle"],
    ];
    return (
        <>
            <header className="sticky top-0 z-30 grid min-h-[78px] grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#e3d9cb] bg-[#fffdf8] px-4 shadow-[0_6px_24px_rgba(63,47,33,0.05)] min-[1100px]:gap-7 min-[1100px]:px-[3vw]">
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
                <div className="flex items-center justify-self-end gap-[9px] whitespace-nowrap [&>div]:hidden sm:[&>div]:flex [&>div]:flex-col [&>div]:text-[10px] [&_small]:text-[#776f65]">
                    <span className="grid size-9 place-items-center rounded-full bg-[#e8eee5] text-[11px] font-extrabold text-[#4c3425]">
                        {user.name
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((word) => word[0])
                            .join("")}
                    </span>
                    <div>
                        <b>{user.name}</b>
                        <small>Guest</small>
                    </div>
                </div>
                <button
                    type="button"
                    className="grid size-10 place-items-center rounded-lg border border-[#e3d9cb] bg-[#f6f1e7] text-[#4c3425] min-[1100px]:hidden"
                    aria-label="Toggle guest navigation"
                    aria-expanded={menu}
                    onClick={() => setMenu(!menu)}
                >
                    <Icon name="menu" />
                </button>
            </header>
            {menu && (
                <nav
                    className="flex flex-wrap gap-3 border-b border-[#e3d9cb] bg-[#fffdf8] p-4 [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-[#4c3425] [&>a]:font-bold"
                    aria-label="Guest navigation"
                >
                    {links.map(([label]) => (
                        <button
                            type="button"
                            key={label}
                            onClick={() => {
                                setMenu(false);
                                openPage(label);
                            }}
                        >
                            {label}
                        </button>
                    ))}
                    <a href="/">Back to Main Site</a>
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
