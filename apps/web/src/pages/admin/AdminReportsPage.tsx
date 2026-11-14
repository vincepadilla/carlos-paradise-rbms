import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import InteractiveReport, { type InteractiveReportActions } from "../../components/admin/reports/InteractiveReport";
import "./admin-reports.css";

const TABS = [
    { value: "reservation", label: "Reservation Report" },
    { value: "guest", label: "Guest Report" },
    { value: "payment", label: "Payment Report" },
    { value: "queue", label: "Reservation Queue Report" },
] as const;

type Tab = typeof TABS[number]["value"];

function validTab(value: string | null): Tab {
    return TABS.some(tab => tab.value === value) ? value as Tab : "reservation";
}

export default function AdminReportsPage() {
    const [params, setParams] = useSearchParams();
    const suppliedTab = params.get("tab");
    const activeTab = validTab(suppliedTab);
    const reportActions = useRef<InteractiveReportActions>(null);
    const tabState = useRef<Record<Tab, string>>({ reservation: '', guest: '', payment: '', queue: '' });
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [actionBusy, setActionBusy] = useState(false);

    useEffect(() => {
        if (suppliedTab !== activeTab) {
            const next = new URLSearchParams(params);
            next.set("tab", "reservation");
            setParams(next, { replace: true });
        }
    }, [activeTab, params, setParams, suppliedTab]);

    useEffect(() => {
        tabState.current[activeTab] = params.toString();
    }, [activeTab, params]);

    const selectTab = (tab: Tab, replace = false) => {
        tabState.current[activeTab] = params.toString();
        const next = new URLSearchParams(tabState.current[tab] || '');
        next.set("tab", tab);
        setParams(next, { replace });
    };

    const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = TABS.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        selectTab(TABS[nextIndex].value);
        tabRefs.current[nextIndex]?.focus();
    };

    return <main className="admin-reports-page">
        <header className="admin-reports-header">
            <div><h1>Reports</h1><p>Review reservation, guest, payment, and queue activity.</p></div>
            <div className="admin-report-actions">
                <button type="button" className="report-print-button" disabled={actionBusy} onClick={() => reportActions.current?.print('summary')}>Print Summary</button>
                <button type="button" className="report-print-button" disabled={actionBusy} onClick={() => reportActions.current?.print('detailed')}>Print Detailed</button>
                <button type="button" className="report-export-button" disabled={actionBusy} onClick={() => reportActions.current?.exportCsv()}>Export</button>
            </div>
        </header>

        <div className="admin-report-tabs" role="tablist" aria-label="Report types">
            {TABS.map((tab, index) => <button
                key={tab.value}
                ref={element => { tabRefs.current[index] = element; }}
                type="button"
                role="tab"
                id={`report-tab-${tab.value}`}
                aria-controls={`report-panel-${tab.value}`}
                aria-selected={activeTab === tab.value}
                tabIndex={activeTab === tab.value ? 0 : -1}
                className={activeTab === tab.value ? "active" : ""}
                onClick={() => selectTab(tab.value)}
                onKeyDown={event => handleTabKey(event, index)}
            >{tab.label}</button>)}
        </div>

        {TABS.map(tab => <div
            key={tab.value}
            id={`report-panel-${tab.value}`}
            role="tabpanel"
            aria-labelledby={`report-tab-${tab.value}`}
            hidden={activeTab !== tab.value}
            tabIndex={0}
        >{activeTab === tab.value && <InteractiveReport ref={reportActions} kind={tab.value} params={params} setParams={setParams} onBusyChange={setActionBusy} />}
        </div>)}
    </main>;
}
