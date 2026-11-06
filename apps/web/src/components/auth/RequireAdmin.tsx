import { createContext, useContext } from "react";
import { Navigate, Outlet } from "react-router";
import { useAuthenticatedSession } from "../../hooks/useAuthenticatedSession";
import { isAdmin, loginDestination, type AuthenticatedUser } from "../../types/auth";

type AdminSession = {
    user: AuthenticatedUser;
    revalidate: () => void;
    clear: () => void;
};
const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
    const session = useContext(AdminSessionContext);
    if (!session) throw new Error("Admin session is only available inside RequireAdmin.");
    return session;
}

export default function RequireAdmin() {
    const { session, revalidate, clear } = useAuthenticatedSession();
    if (session.status === "loading") {
        return <main className="min-h-screen bg-cream p-10 text-center" role="status">Checking your session…</main>;
    }
    if (session.status === "error") {
        return <main className="min-h-screen bg-cream p-10 text-center">
            <p role="alert">{session.message}</p>
            <button type="button" className="mt-4 underline" onClick={revalidate}>Try again</button>
        </main>;
    }
    if (session.status === "anonymous") return <Navigate to="/login" replace />;
    if (!isAdmin(session.user)) return <Navigate to={loginDestination(session.user)} replace />;
    return <AdminSessionContext.Provider value={{ user: session.user, revalidate, clear }}>
        <Outlet />
    </AdminSessionContext.Provider>;
}
