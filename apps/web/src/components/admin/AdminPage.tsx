import type { ReactNode } from "react";

export default function AdminPage({ title, description, children }: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return <section aria-label={title}>
        <h1 className="font-display text-3xl text-brown">{title}</h1>
        {description && <p className="mt-2 text-muted">{description}</p>}
        <div className="mt-6 rounded-xl border border-line bg-paper p-4 sm:p-6">{children}</div>
    </section>;
}
