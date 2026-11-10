import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import ReservationReport, { type ReservationReportActions } from "../../components/admin/reports/ReservationReport";
import PaymentReport from "../../components/admin/reports/PaymentReport";
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
    const reportActions = useRef<ReservationReportActions>(null);
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [actionBusy, setActionBusy] = useState(false);

    useEffect(() => {
        if (suppliedTab !== activeTab) {
            const next = new URLSearchParams(params);
            next.set("tab", "reservation");
            setParams(next, { replace: true });
        }
    }, [activeTab, params, setParams, suppliedTab]);

    const selectTab = (tab: Tab, replace = false) => {
        const next = new URLSearchParams(params);
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
            {(activeTab === "reservation" || activeTab === "guest" || activeTab === "payment") && <div className="admin-report-actions">
                <button type="button" className="report-print-button" disabled={actionBusy} onClick={() => reportActions.current?.print()}>Print</button>
                <button type="button" className="report-export-button" disabled={actionBusy} onClick={() => reportActions.current?.exportCsv()}>Export</button>
            </div>}
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
        >{tab.value === "reservation" || tab.value === "guest"
                ? activeTab === tab.value && <ReservationReport ref={reportActions} reportType={tab.value} params={params} setParams={setParams} onBusyChange={setActionBusy} />
                : tab.value === "payment"
                    ? activeTab === "payment" && <PaymentReport ref={reportActions} params={params} setParams={setParams} onBusyChange={setActionBusy} />
                : activeTab === tab.value && <section className="report-coming-soon"><h2>{tab.label}</h2><p>Coming soon</p></section>}
        </div>)}
    </main>;
}
