import type { User } from "../api";
import GuestHeader from "../components/GuestHeader";

export default function HelpSupportPage({
    user,
    onDashboard,
    onReservations,
    onMakeReservation,
    onProfile,
}: {
    user: User;
    onDashboard: () => void;
    onReservations: () => void;
    onMakeReservation: () => void;
    onProfile: () => void;
}) {
    return (
        <div className="min-h-screen bg-[#f6f1e7] font-sans text-[#2d261f]">
            <GuestHeader
                user={user}
                activePage="help"
                onDashboard={onDashboard}
                onReservations={onReservations}
                onMakeReservation={onMakeReservation}
                onProfile={onProfile}
                onHelp={() => { }}
            />
            <main className="mx-auto w-full max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
                <header className="mb-7">
                    <h1 className="m-0 text-[30px] font-normal leading-tight tracking-[-0.04em] text-[#2d261f]">
                        Help &amp; Support
                    </h1>
                    <p className="mt-2 mb-0 text-sm leading-relaxed text-[#776f65]">
                        Find help with your reservation and stay.
                    </p>
                </header>

                <section className="rounded-xl border border-[#e3d9cb] bg-[#fffdf8] p-6 sm:p-8">
                    <h2 className="m-0 text-xl font-semibold text-[#4c3425]">
                        How can we help?
                    </h2>
                    <p className="mt-3 mb-0 max-w-2xl text-sm leading-relaxed text-[#776f65]">
                        Help and support features will be available in a future update.
                    </p>
                </section>
            </main>
        </div>
    );
}