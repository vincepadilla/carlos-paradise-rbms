import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

type Props = {
    children?: ReactNode;
    className?: string;
    tone?: "hero";
};

export default function MakeReservationButton({
    children = "Make Reservation",
    className,
    tone,
}: Props) {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const submittingRef = useRef(false);

    async function openReservation() {
        if (submittingRef.current) return;

        submittingRef.current = true;
        setBusy(true);

        try {
            const response = await fetch(`${apiBaseUrl}/auth/user`, {
                headers: { Accept: "application/json" },
                credentials: "include",
                cache: "no-store",
            });

            if (response.status === 401) {
                window.alert("Please log in first to make a reservation.");
                return;
            }

            if (!response.ok) {
                throw new Error(`Login check failed (${response.status}).`);
            }

            const data = await response.json();

            if (!data?.user || typeof data.user !== "object") {
                window.alert("Please log in first to make a reservation.");
                return;
            }

            navigate("/make-reservation");
        } catch (error) {
            console.error("Login check failed:", error);

            window.alert(
                error instanceof Error
                    ? error.message
                    : "Unable to check your login. Please try again."
            );
        } finally {
            submittingRef.current = false;
            setBusy(false);
        }
    }

    const defaultStyle =
        tone === "hero"
            ? "inline-flex items-center justify-center gap-3 rounded-full bg-white px-8 py-4 font-semibold text-[#4a3226] transition hover:bg-[#fbf3e6] disabled:opacity-50"
            : "inline-flex items-center justify-center gap-3 rounded-xl bg-[#4a3226] px-6 py-3 font-semibold text-white hover:bg-[#6e4b35] disabled:opacity-50";

    return (
        <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void openReservation()}
            className={className || defaultStyle}
        >
            {busy ? "Checking login…" : children}
        </button>
    );
}