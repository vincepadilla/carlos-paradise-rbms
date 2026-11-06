import type { ReactNode } from "react";

export default function DashboardPanel({ title, copy, action, className = "", children }: {
    title: string; copy: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
    return <section className={`panel ${className}`} aria-label={title}>
        <div className="panel-head"><div><h2>{title}</h2><p>{copy}</p></div>{action}</div>
        {children}
    </section>;
}
