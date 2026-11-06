import type { ReactNode } from "react";

export default function AdminPageHeader({ eyebrow, title, copy, action }: {
    eyebrow?: string; title: string; copy: string; action?: ReactNode;
}) {
    return <div className="page-head">
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{copy}</p></div>
        {action}
    </div>;
}
