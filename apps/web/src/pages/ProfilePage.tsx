import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "../api";
import GuestHeader from "../components/GuestHeader";
import {
    reservationApi,
    ReservationApiError,
} from "../services/ReservationApi";

type Props = {
    user: User;
    onUpdated: (user: User) => void;
    onDashboard: () => void;
    onReservations: () => void;
    onMakeReservation: () => void;
};
const input =
    "min-h-12 w-full min-w-0 rounded-lg border border-[#e3d9cb] bg-white px-4 py-3 text-sm text-[#2d261f] outline-none focus:border-[#b08a52] focus:ring-2 focus:ring-[#b08a52]/20 disabled:bg-[#f6f1e7] disabled:text-[#776f65] read-only:bg-[#f6f1e7]";
function readUser(data: { user: User }, id: number): User {
    if (
        !data.user ||
        Number(data.user.id) !== Number(id) ||
        typeof data.user.name !== "string" ||
        typeof data.user.email !== "string"
    ) {
        throw new Error("The server returned incomplete profile information.");
    }
    return data.user;
}
function message(cause: unknown) {
    if (cause instanceof ReservationApiError && cause.status === 401) {
        return "Your session expired. Sign in again to manage your profile.";
    }
    return cause instanceof Error
        ? cause.message
        : "Unable to update your profile. Please try again.";
}

export default function ProfilePage({
    user,
    onUpdated,
    onDashboard,
    onReservations,
    onMakeReservation,
}: Props) {
    const [profile, setProfile] = useState<User | null>(null);
    const [name, setName] = useState(user.name);
    const [contact, setContact] = useState(user.contact || "");
    const [editing, setEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [success, setSuccess] = useState("");
    const [errors, setErrors] = useState<{ name?: string; contact?: string }>({});
    const updating = useRef(false);
    const mounted = useRef(false);
    const onUpdatedRef = useRef(onUpdated);
    useEffect(() => {
        onUpdatedRef.current = onUpdated;
    }, [onUpdated]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setLoadError("");
        void reservationApi<{ user: User }>(
            "/profile",
            "GET",
            undefined,
            controller.signal,
        )
            .then((data) => {
                if (!active) return;
                const saved = readUser(data, user.id);
                setProfile(saved);
                setName(saved.name);
                setContact(saved.contact || "");
                setEditing(false);
                onUpdatedRef.current(saved);
            })
            .catch((cause) => {
                if (active && !controller.signal.aborted) setLoadError(message(cause));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
            controller.abort();
        };
    }, [user.id, attempt]);

    const current = profile || user;
    const dirty =
        !!profile &&
        (name.trim() !== profile.name ||
            contact.trim() !== (profile.contact || ""));
    const initials = current.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase();

    function cancel() {
        if (updating.current) return;
        setName(current.name);
        setContact(current.contact || "");
        setErrors({});
        setSaveError("");
        setEditing(false);
    }
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!profile || loading || updating.current || !editing) return;
        const nextErrors: { name?: string; contact?: string } = {};
        if (!name.trim()) nextErrors.name = "Enter your full name.";
        else if (name.trim().length > 255)
            nextErrors.name = "Use no more than 255 characters.";
        if (contact.trim().length < 7)
            nextErrors.contact = "Enter a contact number with at least 7 characters.";
        else if (contact.trim().length > 30)
            nextErrors.contact = "Use no more than 30 characters.";
        setErrors(nextErrors);
        setSaveError("");
        setSuccess("");
        if (Object.keys(nextErrors).length || !dirty) return;
        updating.current = true;
        setSaving(true);
        try {
            const data = await reservationApi<{ user: User }>("/profile", "PATCH", {
                name: name.trim(),
                contact: contact.trim(),
            });
            const saved = readUser(data, user.id);
            onUpdatedRef.current(saved);
            if (mounted.current) {
                setProfile(saved);
                setName(saved.name);
                setContact(saved.contact || "");
                setEditing(false);
                setSuccess("Your profile has been updated successfully.");
            }
        } catch (cause) {
            if (mounted.current) setSaveError(message(cause));
        } finally {
            updating.current = false;
            if (mounted.current) setSaving(false);
        }
    }
    return (
        <div className="min-h-screen bg-[#f6f1e7] font-sans text-[#2d261f] [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-[#b08a52]">
            <GuestHeader
                user={user}
                activePage="profile"
                onProfile={() => { }}
                onDashboard={onDashboard}
                onReservations={onReservations}
                onMakeReservation={onMakeReservation}
            />
            <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-10">
                <div className="mb-7">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b08a52]">
                        Your Account
                    </span>
                    <h1 className="mt-2 mb-2 text-[30px] font-normal tracking-[-0.04em]">
                        My Profile
                    </h1>
                    <p className="m-0 text-sm text-[#776f65]">
                        Keep your personal details up to date for your next stay.
                    </p>
                </div>
                <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <aside className="overflow-hidden rounded-2xl border border-[#e3d9cb] bg-[#fffdf8]">
                        <div className="h-20 bg-[#e8eee5]" />
                        <div className="px-6 pb-7 text-center">
                            <div
                                className="relative mx-auto -mt-10 mb-4 grid size-20 place-items-center rounded-full border-4 border-[#fffdf8] bg-[#4c3425] text-xl font-semibold text-white"
                                aria-hidden="true"
                            >
                                {initials || "CP"}
                            </div>
                            <h2 className="mb-2 text-lg font-semibold wrap-anywhere">
                                {current.name}
                            </h2>
                            <p className="mb-4 text-xs text-[#776f65] wrap-anywhere">
                                {current.email}
                            </p>
                            <span className="inline-flex rounded-full bg-[#e8eee5] px-3 py-1.5 text-[10px] font-semibold capitalize text-[#59754f]">
                                {current.role} Account
                            </span>
                        </div>
                        <p className="m-0 border-t border-[#e3d9cb] px-6 py-5 text-xs leading-6 text-[#776f65]">
                            Your account details help us contact you about your stay. Existing
                            reservation contact details remain as submitted.
                        </p>
                    </aside>
                    <section
                        className="min-w-0 rounded-2xl border border-[#e3d9cb] bg-[#fffdf8] p-5 md:p-8"
                        aria-labelledby="personal-information-title"
                        aria-busy={loading || saving}
                    >
                        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <h2
                                    id="personal-information-title"
                                    className="m-0 text-xl font-normal"
                                >
                                    Personal Information
                                </h2>
                                <p className="mt-2 mb-0 text-xs leading-6 text-[#776f65]">
                                    Manage your name and contact number.
                                </p>
                            </div>
                            {!editing && (
                                <button
                                    type="button"
                                    disabled={loading || !profile || !!loadError}
                                    onClick={() => {
                                        setEditing(true);
                                        setSuccess("");
                                        setSaveError("");
                                    }}
                                    className="min-h-11 rounded-lg border border-[#e3d9cb] bg-[#f6f1e7] px-4 py-3 text-xs font-semibold text-[#4c3425] hover:bg-[#eee6d8] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Edit Profile
                                </button>
                            )}
                        </div>
                        {loading && (
                            <p
                                role="status"
                                className="mb-5 rounded-lg bg-[#f6f1e7] p-4 text-xs text-[#776f65]"
                            >
                                Loading your saved profile…
                            </p>
                        )}
                        {loadError && (
                            <div
                                role="alert"
                                className="mb-5 rounded-lg bg-[#f7e6e3] p-4 text-xs text-[#a44b45]"
                            >
                                <p className="m-0">{loadError}</p>
                                <button
                                    type="button"
                                    className="mt-3 font-semibold underline"
                                    onClick={() => setAttempt((value) => value + 1)}
                                >
                                    Try Again
                                </button>
                            </div>
                        )}
                        {success && (
                            <p
                                role="status"
                                className="mb-5 rounded-lg bg-[#e8eee5] p-4 text-xs text-[#59754f]"
                            >
                                {success}
                            </p>
                        )}
                        {saveError && (
                            <p
                                role="alert"
                                className="mb-5 rounded-lg bg-[#f7e6e3] p-4 text-xs text-[#a44b45]"
                            >
                                {saveError}
                            </p>
                        )}
                        <form onSubmit={(event) => void save(event)} noValidate>
                            <fieldset
                                disabled={!editing || saving || loading || !!loadError}
                                className="m-0 grid min-w-0 gap-5 border-0 p-0"
                            >
                                <label
                                    className="grid min-w-0 gap-2 text-xs font-semibold"
                                    htmlFor="profile-name"
                                >
                                    <span id="profile-name-label">Full Name</span>
                                    <input
                                        id="profile-name"
                                        aria-labelledby="profile-name-label"
                                        name="name"
                                        autoComplete="name"
                                        maxLength={255}
                                        required
                                        value={name}
                                        onChange={(event) => {
                                            setName(event.target.value);
                                            setErrors((value) => ({ ...value, name: undefined }));
                                        }}
                                        aria-invalid={!!errors.name}
                                        aria-describedby={
                                            errors.name ? "profile-name-error" : undefined
                                        }
                                        className={input}
                                    />
                                    {errors.name && (
                                        <span
                                            id="profile-name-error"
                                            className="text-xs font-normal text-[#a44b45]"
                                        >
                                            {errors.name}
                                        </span>
                                    )}
                                </label>
                                <label
                                    className="grid min-w-0 gap-2 text-xs font-semibold"
                                    htmlFor="profile-contact"
                                >
                                    <span id="profile-contact-label">Contact Number</span>
                                    <input
                                        id="profile-contact"
                                        aria-labelledby="profile-contact-label"
                                        name="contact"
                                        type="tel"
                                        autoComplete="tel"
                                        minLength={7}
                                        maxLength={30}
                                        required
                                        value={contact}
                                        onChange={(event) => {
                                            setContact(event.target.value);
                                            setErrors((value) => ({ ...value, contact: undefined }));
                                        }}
                                        aria-invalid={!!errors.contact}
                                        aria-describedby={
                                            errors.contact ? "profile-contact-error" : undefined
                                        }
                                        className={input}
                                    />
                                    {errors.contact && (
                                        <span
                                            id="profile-contact-error"
                                            className="text-xs font-normal text-[#a44b45]"
                                        >
                                            {errors.contact}
                                        </span>
                                    )}
                                </label>
                            </fieldset>
                            <label
                                className="mt-5 grid min-w-0 gap-2 text-xs font-semibold"
                                htmlFor="profile-email"
                            >
                                <span id="profile-email-label">Email Address</span>
                                <input
                                    id="profile-email"
                                    aria-labelledby="profile-email-label"
                                    type="email"
                                    autoComplete="email"
                                    readOnly
                                    value={current.email}
                                    aria-describedby="profile-email-note"
                                    className={input}
                                />
                                <span
                                    id="profile-email-note"
                                    className="text-[11px] font-normal leading-6 text-[#776f65]"
                                >
                                    This email is used to sign in. Contact the resort if you need
                                    to change it.
                                </span>
                            </label>
                            {editing && (
                                <div className="mt-7 flex flex-col-reverse justify-end gap-3 border-t border-[#e3d9cb] pt-6 sm:flex-row">
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={cancel}
                                        className="min-h-12 rounded-lg border border-[#e3d9cb] px-5 py-3 text-xs font-semibold text-[#4c3425] disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving || loading || !dirty || !!loadError}
                                        className="min-h-12 rounded-lg bg-[#4c3425] px-6 py-3 text-xs font-semibold text-white hover:bg-[#6e4b35] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {saving ? "Saving Changes…" : "Save Changes"}
                                    </button>
                                </div>
                            )}
                        </form>
                    </section>
                </div>
            </main>
        </div>
    );
}
