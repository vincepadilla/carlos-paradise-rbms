import { useCallback, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import AdminResource from "../../components/admin/AdminResource";
import AdminPagination from "../../components/admin/AdminPagination";
import { OwnerApi } from "../../services/OwnerApi";
import { useOwnerAction } from "../../hooks/useOwnerAction";
import type { OwnerAdmin } from "../../types/owner";
import { ActionNotice, OwnerDialog, OwnerPage } from "./OwnerUI";

function AdminEditor({ admin, onClose, onSaved }: { admin: OwnerAdmin | null; onClose: () => void; onSaved: () => void }) {
    const [name, setName] = useState(admin?.name ?? "");
    const [email, setEmail] = useState(admin?.email ?? "");
    const [password, setPassword] = useState("");
    const action = useOwnerAction();
    function submit(event: FormEvent) {
        event.preventDefault();
        void action.run(async () => {
            const data = { name: name.trim(), email: email.trim(), ...(password ? { password } : {}) };
            if (admin) await OwnerApi.updateAdmin(admin.id, data);
            else await OwnerApi.createAdmin(data);
            onSaved();
        });
    }
    return <OwnerDialog title={admin ? "Edit Admin" : "Add Admin"} busy={action.busy} onClose={onClose}>
        <form onSubmit={submit}><ActionNotice {...action} />
            <label className="owner-field">Full Name<input autoFocus name="name" required maxLength={255} value={name} disabled={action.busy} onChange={e => setName(e.target.value)} /></label>
            <label className="owner-field">Email Address<input type="email" name="email" required maxLength={254} value={email} disabled={action.busy} onChange={e => setEmail(e.target.value)} /></label>
            <label className="owner-field">{admin ? "New Password (optional)" : "Password"}<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required={!admin} value={password} disabled={action.busy} onChange={e => setPassword(e.target.value)} /><small>At least 12 characters with uppercase and lowercase letters and a number.</small></label>
            <div className="owner-actions"><button className="admin-button" type="button" disabled={action.busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? "Saving…" : admin ? "Save Changes" : "Add Admin"}</button></div>
        </form>
    </OwnerDialog>;
}

export default function OwnerAdminsPage() {
    const [query, setQuery] = useSearchParams();
    const [revision, setRevision] = useState(0);
    const [editor, setEditor] = useState<OwnerAdmin | null | undefined>(undefined);
    const [toggle, setToggle] = useState<OwnerAdmin | null>(null);
    const action = useOwnerAction();
    const search = query.get("search") ?? "";
    const page = Math.max(1, Number(query.get("page")) || 1);
    const load = useCallback((signal: AbortSignal) => OwnerApi.admins(new URLSearchParams({ search, page: String(page) }), signal), [search, page, revision]);
    function saved() { setEditor(undefined); setRevision(v => v + 1); }
    return <OwnerPage title="Admin Management" copy="Manage the people who handle daily resort operations." action={<button className="btn btn-primary" onClick={() => setEditor(null)}>+ Add Admin</button>}>
        <ActionNotice {...action} />
        <div className="owner-card"><div className="owner-toolbar"><label className="owner-field">Search Admins<input type="search" placeholder="Search name or email…" value={search} onChange={event => setQuery({ search: event.target.value })} /></label></div>
            <AdminResource load={load} showRefresh={false}>{data => <>
                <div className="admin-table-scroll"><table className="admin-table owner-admins-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>{data.data.map(admin => <tr key={admin.id}><td>{admin.name}</td><td>{admin.email}</td><td>Admin</td><td><span className={`owner-badge${admin.is_active ? "" : " owner-badge-inactive"}`}>{admin.is_active ? "Active" : "Disabled"}</span></td><td><div className="owner-table-actions"><button className="admin-button" onClick={() => setEditor(admin)}>Edit</button><button className="admin-button" disabled={action.busy} onClick={() => setToggle(admin)}>{admin.is_active ? "Disable" : "Enable"}</button></div></td></tr>)}</tbody></table></div>
                {!data.data.length && <p className="owner-empty">No Admin accounts match your search.</p>}
                <AdminPagination page={data.current_page} lastPage={data.last_page} total={data.total} onChange={next => setQuery({ search, page: String(next) })} />
            </>}</AdminResource>
        </div>
        {editor !== undefined && <AdminEditor admin={editor} onClose={() => setEditor(undefined)} onSaved={saved} />}
        {toggle && <OwnerDialog title={`${toggle.is_active ? "Disable" : "Enable"} Admin?`} busy={action.busy} onClose={() => setToggle(null)}>
            <p>{toggle.is_active ? `${toggle.name} will lose access to the Admin portal, including existing sessions.` : `Restore Admin access for ${toggle.name}?`}</p>
            <ActionNotice {...action} /><div className="owner-actions"><button className="admin-button" disabled={action.busy} onClick={() => setToggle(null)}>Cancel</button><button className="btn btn-primary" disabled={action.busy} onClick={() => void action.run(async () => { await OwnerApi.updateAdmin(toggle.id, { is_active: !toggle.is_active }); setToggle(null); setRevision(v => v + 1); }, "Admin access updated.")}>{action.busy ? "Saving…" : "Confirm"}</button></div>
        </OwnerDialog>}
    </OwnerPage>;
}
