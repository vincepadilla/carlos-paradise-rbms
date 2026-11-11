import { useCallback } from "react";
import { Link, NavLink, Navigate, useNavigate, type LinkProps, type NavLinkProps, type NavigateProps, type NavigateFunction, type NavigateOptions, type To } from "react-router";
import { useAdminSession } from "../auth/RequireAdmin";

// Existing operational destinations are shared by both portals, including links returned by the API.
export function staffDestination(to: To, role: string | null): To {
    const rewrite = (path: string) => role === "owner" ? path.replace(/^\/admin(?=\/|\?|#|$)/, "/owner") : path;
    return typeof to === "string" ? rewrite(to) : { ...to, pathname: to.pathname ? rewrite(to.pathname) : to.pathname };
}

export function StaffLink({ to, ...props }: LinkProps) {
    const { user } = useAdminSession();
    return <Link {...props} to={staffDestination(to, user.role)} />;
}

export function StaffNavLink({ to, ...props }: NavLinkProps) {
    const { user } = useAdminSession();
    return <NavLink {...props} to={staffDestination(to, user.role)} />;
}

export function StaffNavigate({ to, ...props }: NavigateProps) {
    const { user } = useAdminSession();
    return <Navigate {...props} to={staffDestination(to, user.role)} />;
}

export function useStaffNavigate(): NavigateFunction {
    const navigate = useNavigate();
    const { user } = useAdminSession();
    return useCallback(((to: To | number, options?: NavigateOptions) => {
        if (typeof to === "number") return navigate(to);
        return navigate(staffDestination(to, user.role), options);
    }) as NavigateFunction, [navigate, user.role]);
}
