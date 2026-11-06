import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { logoutReservationSession } from "../../services/ReservationApi";
import { useAdminSession } from "../auth/RequireAdmin";

export default function AdminSignOutButton() {
    const { clear } = useAdminSession();
    const navigate = useNavigate();
    const [signingOut, setSigningOut] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);

    async function signOut() {
        if (submitting.current) return;
        submitting.current = true;
        setSigningOut(true);
        setError("");
        try {
            await logoutReservationSession();
            clear();
            navigate("/login", { replace: true });
        } catch {
            setError("Unable to sign out. Please try again.");
            submitting.current = false;
            setSigningOut(false);
        }
    }

    return <>
        <button type="button" data-admin-signout disabled={signingOut} onClick={() => void signOut()}>
            {signingOut ? "Signing out…" : "Sign Out"}
        </button>
        {error && <p role="alert" className="admin-signout-error">{error}</p>}
    </>;
}
