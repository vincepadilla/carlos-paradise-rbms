import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Settings, User } from "../api";
import ReservationPage from "./ReservationPage";

const apiBaseUrl = (
    import.meta.env.VITE_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");
// Sample values from the uploaded source; UI testing only.
const previewSettings: Settings = {
    name: "Carlos Paradise",
    contact: "Sample contact",
    payment_instructions: "Preview only — no payments accepted.",
    weekday_rate: 16000,
    friday_saturday_rate: 22000,
    sunday_rate: 18000,
    special_rate: 22000,
    holiday_surcharge: 2000,
    special_dates: ["12-24", "12-25", "12-31", "01-01"],
    holiday_dates: [],
    standard_guests: 20,
    max_guests: 40,
    extra_guest_fee: 500,
    cleaning_threshold: 30,
    cleaning_fee: 1000,
    bonfire_price: 400,
    charcoal_price: 30,
    deposit: 5000,
    security_deposit: 3000,
    opportunity_hours: 24,
    min_lead_days: 2,
};
export default function ReservationRoute() {
    const navigate = useNavigate();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        async function loadAccount() {
            setLoading(true);
            setError("");
            try {
                // Existing authentication only. No reservation endpoints are called.
                const response = await fetch(`${apiBaseUrl}/auth/user`, {
                    headers: { Accept: "application/json" },
                    credentials: "include",
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!active) return;
                if (response.status === 401) {
                    navigate("/login", { replace: true });
                    return;
                }
                if (!response.ok)
                    throw new Error(`Unable to check your account (${response.status}).`);
                const data = await response.json();
                if (!active) return;
                if (!data?.user) {
                    navigate("/login", { replace: true });
                    return;
                }
                if (
                    typeof data.user !== "object" ||
                    typeof data.user.name !== "string" ||
                    typeof data.user.email !== "string"
                ) {
                    throw new Error(
                        "The account response is missing a name or email address.",
                    );
                }
                setUser(data.user as User);
            } catch (cause) {
                if (active && !controller.signal.aborted)
                    setError(
                        cause instanceof Error
                            ? cause.message
                            : "Unable to load your account.",
                    );
            } finally {
                if (active) setLoading(false);
            }
        }
        void loadAccount();
        return () => {
            active = false;
            controller.abort();
        };
    }, [navigate, attempt]);
    return (
        <main className="min-h-screen bg-[#fbf3e6]">
            {loading ? (
                <p role="status" className="p-10 text-center text-[#4a3226]">
                    Loading your account…
                </p>
            ) : error ? (
                <section role="alert" className="mx-auto max-w-xl p-8 text-[#a44b45]">
                    <p>{error}</p>
                    <button
                        type="button"
                        className="mt-4 underline"
                        onClick={() => setAttempt((value) => value + 1)}
                    >
                        Try again
                    </button>
                </section>
            ) : user ? (
                <ReservationPage user={user} settings={previewSettings} />
            ) : (
                <p className="p-10 text-center">
                    Please sign in to preview the reservation form.
                </p>
            )}
        </main>
    );
}
