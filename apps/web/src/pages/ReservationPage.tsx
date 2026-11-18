import { useEffect, useState } from "react";
import type { User, Settings } from "../api";
import type { SettingsResponse } from "../types/reservation";
import { reservationApi, resetReservationCsrf } from "../services/ReservationApi";
import MakeReservationPage from "./MakeReservationPage";

export default function ReservationPage({
    user,
    initialPage = "reservation",
}: {
    user?: User | null;
    settings?: Settings | null;
    initialPage?: "reservation" | "dashboard" | "reservations" | "profile";
}) {
    const [configuration, setConfiguration] = useState<SettingsResponse | null>(
        null,
    );
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!user) return;
        const controller = new AbortController();
        let active = true;
        resetReservationCsrf();
        setConfiguration(null);
        setError("");
        void reservationApi<SettingsResponse>(
            "/settings",
            "GET",
            undefined,
            controller.signal,
        )
            .then((data) => {
                if (!data.settings || !Array.isArray(data.payment_methods))
                    throw new Error("The settings response is incomplete.");
                if (active) setConfiguration(data);
            })
            .catch((cause) => {
                if (active && !controller.signal.aborted)
                    setError(
                        cause instanceof Error
                            ? cause.message
                            : "Unable to load reservation settings.",
                    );
            });
        return () => {
            active = false;
            controller.abort();
        };
    }, [user?.id, attempt]);
    if (!user)
        return (
            <main className="min-h-screen bg-[#f6f1e7] p-8 text-[#4c3425]">
                Please{" "}
                <a href="/login" className="underline">
                    sign in
                </a>{" "}
                to make a reservation.
            </main>
        );
    if (error)
        return (
            <main className="min-h-screen bg-[#f6f1e7] p-8 text-[#4c3425]">
                <p role="alert">{error}</p>
                <button
                    type="button"
                    className="mt-4 underline"
                    onClick={() => setAttempt((n) => n + 1)}
                >
                    Try again
                </button>
            </main>
        );
    if (!configuration)
        return (
            <main
                className="min-h-screen bg-[#f6f1e7] p-10 text-center text-[#4c3425]"
                role="status"
            >
                Loading reservation settings…
            </main>
        );
    return (
        <MakeReservationPage
            key={user.id}
            user={user}
            settings={configuration.settings}
            paymentMethods={configuration.payment_methods}
            initialPage={initialPage}
        />
    );
}
