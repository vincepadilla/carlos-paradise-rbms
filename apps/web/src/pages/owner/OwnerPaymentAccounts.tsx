import { useCallback, useState, type FormEvent } from "react";
import AdminResource from "../../components/admin/AdminResource";
import { OwnerApi } from "../../services/OwnerApi";
import { useOwnerAction } from "../../hooks/useOwnerAction";
import type { PaymentAccount } from "../../types/owner";
import { ActionNotice, OwnerDialog } from "./OwnerUI";

function AccountEditor({ account, onClose, onSaved }: { account: PaymentAccount | null; onClose: () => void; onSaved: () => void }) {
    const [data, setData] = useState({ id: account?.id, name: account?.name ?? "", account_name: account?.account_name ?? "", account_number: account?.account_number ?? "", instructions: account?.instructions ?? "", is_active: account ? Boolean(account.is_active) : true });
    const action = useOwnerAction();
    function submit(event: FormEvent) { event.preventDefault(); void action.run(async () => { await OwnerApi.savePaymentMethod(data); onSaved(); }); }
    return <OwnerDialog title={account ? "Edit Payment Account" : "Add Payment Account"} busy={action.busy} onClose={onClose}><form onSubmit={submit}><ActionNotice {...action} />
        {([['name', 'Payment Method'], ['account_name', 'Account Name'], ['account_number', 'Account Number'], ['instructions', 'Instructions']] as const).map(([key, label]) => <label key={key} className="owner-field">{label}<input required={key !== 'instructions'} maxLength={key === 'instructions' ? 5000 : 255} value={data[key]} disabled={action.busy} onChange={e => setData(current => ({ ...current, [key]: e.target.value }))} /></label>)}
        <label><input type="checkbox" checked={data.is_active} disabled={action.busy} onChange={e => setData(current => ({ ...current, is_active: e.target.checked }))} /> Active receiving account</label>
        <div className="owner-actions"><button type="button" className="admin-button" disabled={action.busy} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? "Saving…" : "Save Account"}</button></div>
    </form></OwnerDialog>;
}

export default function OwnerPaymentAccounts() {
    const [revision, setRevision] = useState(0);
    const [editor, setEditor] = useState<PaymentAccount | null | undefined>(undefined);
    const load = useCallback((signal: AbortSignal) => OwnerApi.paymentMethods(signal), [revision]);
    return <div className="mt-8"><h3>Receiving Accounts</h3><p>Active accounts appear in the guest payment flow. Existing payment records are preserved when an account is disabled.</p>
        <AdminResource load={load} showRefresh={false}>{data => <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Method</th><th>Account</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.payment_methods.map(account => <tr key={account.id}><td>{account.name}</td><td>{account.account_name}<br />{account.account_number}</td><td>{account.is_active ? "Active" : "Disabled"}</td><td><button className="admin-button" onClick={() => setEditor(account)}>Edit</button></td></tr>)}</tbody></table>{!data.payment_methods.length && <p>No receiving accounts configured.</p>}</div>}</AdminResource>
        <button className="admin-button mt-4" onClick={() => setEditor(null)}>Add Payment Account</button>
        {editor !== undefined && <AccountEditor account={editor} onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setRevision(v => v + 1); }} />}
    </div>;
}
