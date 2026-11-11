// Isolated browser checks: only test fixtures are returned by application fetch calls.
// No credential form is submitted and reCAPTCHA is never changed or bypassed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ownerFixtureResponse, runOwnerChecks } from './owner-browser-checks.mjs';

const base = process.env.RBMS_TEST_URL || "http://127.0.0.1:5175";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use a local test server.");
assert.ok((await fetch(base)).ok, "Start Vite on port 5175 before running this script.");
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "rbms-admin-check-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
{ windowsHide: true, stdio: "ignore" });
let launchError;
chrome.on("error", error => { launchError = error; });
let socket;
let checks = 0;
const capture = process.env.RBMS_CAPTURE_SCREENSHOTS === "1" || process.argv.includes('--capture');
const screenshots = resolve("node_modules/.tmp/admin-visual");

function installFixtures() {
    const state = JSON.parse(sessionStorage.getItem("rbms-admin-test") || '{"role":"admin"}');
    const requests = [];
    window.__adminQA = { state, requests, documentId: crypto.randomUUID() };
    const reservation = {
        id: 1, user_id: 2, reference: "TEST-RESERVATION", status: "awaiting_deposit", type: "overnight",
        starts_at: "2027-01-10T14:00:00+08:00", ends_at: "2027-01-11T11:00:00+08:00", adults: 2, children: 0, pets: 0,
        total: "16000.00", deposit: "5000.00", deadline: "2027-01-09T14:00:00+08:00", contact_name: "Test Guest",
        contact_email: "guest@example.test", contact_phone: "09171234567", notes: null, payments: [],
        queue_position: 1, opportunity: { id: 1, status: "active" }, extension_status: null, extension_reason: null,
        extension_message: null, extension_date: null,
    };
    if (state.detailsMode === "day_tour") { reservation.type = "day_tour"; reservation.starts_at = new Date(Date.now() + 20 * 86400000).toISOString(); reservation.ends_at = new Date(Date.now() + 21 * 86400000).toISOString(); }
    if (state.detailsMode === "extension") {
        reservation.starts_at = new Date(Date.now() + 20 * 86400000).toISOString(); reservation.ends_at = new Date(Date.now() + 21 * 86400000).toISOString();
        reservation.extension_status = "pending"; reservation.extension_date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        reservation.extension_reason = "Guest agreed payment date"; reservation.extension_message = "Please review this request.";
    }
    if (state.detailsMode) reservation.payments = [{ id: 810, reference: "DETAIL-APPROVED", method: "GCash", amount: "1000.50", status: "approved", review_note: "Verified transfer" }, { id: 811, reference: "DETAIL-PENDING", method: "Bank", amount: "5000.00", status: "submitted", review_note: null }];
    const details = { inquiry_source: "Phone Call", bonfire_qty: 2, charcoal_qty: 3, pricing: { base: "15000.00", holiday_fee: "0.00", extra_fee: "500.00", cleaning_fee: "0.00", optional_fee: "890.00", bonfire: "800.00", charcoal: "90.00", security_deposit: "2500.00" } };
    if (state.managementMode) {
        const ongoing = ['ongoing','completed','past'].includes(state.managementMode);
        const local = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0,10);
        Object.assign(reservation,{ status:state.managementMode==='unpaid' ? 'awaiting_deposit' : state.managementMode==='completed' ? 'completed' : 'confirmed',
            starts_at:local(ongoing?-1:10)+'T14:00:00+08:00', ends_at:local(state.managementMode==='past'?-1:ongoing?1:11)+'T11:00:00+08:00', total:'16390.00',
            deadline:local(1)+'T18:00:00+08:00', extension_access:null,
            payments:state.managementMode==='unpaid'?[]:[{id:1201,reference:'MANAGEMENT-VERIFIED',method:'GCash',amount:'5000.00',status:'approved',review_note:'Actual transfer verified'}],
        },state.managedReservation??{});
        Object.assign(details,{revision:0,contact_address:'Booking snapshot address',configured_security_deposit:'3000.00',damages:[],totals:{damage_total:'0.00',paid:state.managementMode==='unpaid'?'0.00':'5000.00',amount_due:'11390.00',credit_balance:'0.00'},
            capabilities:{can_edit:!['completed','past','unpaid'].includes(state.managementMode),can_manage_damages:state.managementMode==='ongoing',can_complete:['ongoing','past'].includes(state.managementMode),can_grant_extension:state.managementMode==='unpaid'},
            pricing:{...details.pricing,version:2,liquor:'0.00',other:'0.00',discount:{type:'none',value:'0.00',amount:'0.00',justification:null}},
        },state.managedDetails??{});
        reservation.damage_total=details.totals.damage_total; reservation.amount_due=details.totals.amount_due;
    }
    if (state.paymentReviewMode) {
        Object.assign(reservation, {
            starts_at: new Date(Date.now() + 5 * 86400000).toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString(), status: "payment_review",
            payments: state.paymentReviewMode === "none" ? [] : [{ id: 1101, reference: "PAYMENT-QA-1101", method: "GCash", amount: state.paymentReviewMode === "mismatch" ? "4000.00" : "5000.00", status: "submitted", payment_date: new Date().toISOString().slice(0, 10), submitted_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null, review_note: null }],
        }, state.reviewRecord ?? {});
    }
    const guest = { id: 2, name: "Test Guest", email: "guest@example.test", phone: null, address: null, latest_booking_reference: "TEST-RESERVATION", is_active: true, email_verified_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(state.guestRecord ?? {}) };
    const guestReservation = { id: 1, booking_reference: "TEST-RESERVATION", status: "confirmed", contact_address: "Test address",
        requested_at: new Date().toISOString(), starts_at: reservation.starts_at, ends_at: reservation.ends_at, adults: 2, children: 0,
        required_deposit: "5000.00", payment_status: "Verified", payment_amount: "5000.00", payment_amount_kind: "verified" };
    const guestPayment = { id: 1, reservation_id: 1, booking_reference: "TEST-RESERVATION", amount: "5000.00", status: "approved", payment_kind: "deposit", reference: "TEST-PAYMENT", payment_date: new Date().toISOString().slice(0, 10), submitted_at: new Date().toISOString(), method: "GCash" };
    const guestActivity = { id: "account-created", kind: "account", event: "account_created", from_status: null, to_status: null, reason: null, occurred_at: new Date().toISOString(), reservation_id: null, booking_reference: null, actor_name: "Test Guest" };
    const day = 86_400_000;
    const at = offset => new Date(Date.now() + offset * day).toISOString();
    const records = state.dashboardMode === "empty" ? [] : state.dashboardMode === "populated" ? [
        { ...reservation, id: 10, reference: "TEST-ONGOING", contact_name: "Marina Santos", status: "confirmed", adults: 18, children: 2,
            starts_at: at(-1), ends_at: at(1), payments: [{ id: 800, amount: "5000.00", status: "approved", method: "GCash", reference: "TEST-APPROVED", review_note: null }] },
        reservation,
        { ...reservation, id: 3, reference: "TEST-QUEUED", contact_name: "Rafael Cruz", queue_position: 2, status: "queued" },
        { ...reservation, id: 20, reference: "TEST-REVIEW-20", contact_name: "Elena Flores", status: "payment_review",
            payments: [{ id: 901, amount: "2000.00", status: "submitted", method: "GCash", reference: "TEST-RECEIPT-20", review_note: null }] },
        { ...reservation, id: 21, reference: "TEST-REVIEW-21", contact_name: "Nico Ramos", status: "payment_review",
            payments: [{ id: 902, amount: "5000.00", status: "submitted", method: "GCash", reference: "TEST-RECEIPT-21", review_note: null }] },
        { ...reservation, id: 30, reference: "TEST-FUTURE", contact_name: "Lara Garcia", status: "confirmed", starts_at: at(2), ends_at: at(3) },
    ] : [reservation];
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const date = value => `${month}-${String(value).padStart(2, '0')}`;
    const calendarRecords = state.calendarMode === "populated" ? [
        { ...reservation, id: 44, reference: "CAL-ONGOING", status: "confirmed", contact_name: "Test Active Guest", starts_at: at(-1), ends_at: at(1) },
        { ...reservation, id: 40, reference: "CAL-SECURED", status: "confirmed", contact_name: "Test Secured Guest", starts_at: date(8) + "T14:00:00+08:00", ends_at: date(10) + "T11:00:00+08:00" },
        { ...reservation, id: 41, reference: "CAL-COMPLETED", status: "completed", contact_name: "Test Past Guest", starts_at: date(2) + "T14:00:00+08:00", ends_at: date(3) + "T11:00:00+08:00" },
        { ...reservation, id: 42, reference: "CAL-DEPOSIT", contact_name: "Test Opportunity Guest", starts_at: date(12) + "T14:00:00+08:00", ends_at: date(14) + "T11:00:00+08:00" },
        { ...reservation, id: 43, reference: "CAL-QUEUE", status: "queued", contact_name: "Test Waiting Guest", starts_at: date(13) + "T14:00:00+08:00", ends_at: date(15) + "T11:00:00+08:00" },
    ] : records;
    const blocks = state.calendarBlocks ?? (state.calendarMode === "populated" ? [{ id: 80, starts_on: date(22), ends_on: date(23), reason: "Maintenance\n\nStaff access only" }] : []);
    window.__adminQA.blocks = blocks;
    window.__adminQA.today = today;
    const original = window.fetch.bind(window);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, location.origin);
        const rawPath = url.pathname;
        const path = rawPath.replace(/^\/api\/owner\/operations(?=\/)/, '/api/admin');
        if (!path.startsWith("/auth/") && !path.startsWith("/api/")) return original(input, options);
        requests.push({ path: rawPath, query: url.search, credentials: options.credentials, method: options.method || "GET", headers: options.headers, body: options.body });
        const ownerResponse = window.__ownerFixtureResponse(url, options, state);
        if (ownerResponse) return ownerResponse;
        if (/^\/api\/admin\/reports\/(reservations|guests|payments)$/.test(path)) return json({
            data: [], total: 0, current_page: 1, last_page: 1, per_page: 15, from: null, to: null,
            generated_at: new Date().toISOString(), filters: { applied: { search: '', date_range: 'this_month', status: '', payment_status: '', start_date: '', end_date: '', date_label: 'This Month' }, statuses: [], date_ranges: [] },
        });
        if (path === '/api/admin/notifications/unread-count') return json({ unread_count: 0 });
        if (path === '/api/admin/notifications' || path === '/api/admin/outgoing-emails') return json({ data: [], total: 0, current_page: 1, last_page: 1, from: null, to: null });
        if (path === "/auth/user") {
            const account = { role: state.role, name: state.adminName || "Test Admin", error: state.sessionError, status: state.sessionStatus };
            if (state.delay) await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, state.delay);
                const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
                if (!state.ignoreAuthAbort) {
                    if (options.signal?.aborted) abort();
                    else options.signal?.addEventListener("abort", abort, { once: true });
                }
            });
            if (account.error) return json({ message: "Test server unavailable" }, 503);
            if (account.status) return json({ message: "Session rejected" }, account.status);
            if (account.role === "anonymous") return json({ message: "Unauthenticated" }, 401);
            return json({ user: { id: state.accountId ?? 1, name: account.name, email: "admin@example.test", phone: null, avatar: null,
                role: account.role === "null" ? null : account.role, email_verified: true } });
        }
        if (path === "/api/csrf") return json({ token: "isolated-csrf-fixture" });
        if (/^\/api\/admin\/reservations\/1(\/complete|\/extension-access)?$/.test(path) && ['PATCH','POST','DELETE'].includes(options.method)) {
            if (state.managementConflict) return json({errors:{dates:['These dates overlap another active commitment or blocked period.']}},422);
            if (state.managementStale) return json({message:'This reservation changed in another session. Reload its latest details before saving.'},409);
            const body=JSON.parse(options.body);
            if (options.method==='PATCH') {
                for (const key of ['contact_name','contact_email','contact_phone','type','adults','children','pets','notes']) reservation[key]=body[key];
                reservation.starts_at=body.checkin+'T'+body.checkin_time+':00+08:00'; reservation.ends_at=body.checkout+'T'+body.checkout_time+':00+08:00';
                details.contact_address=body.contact_address; details.inquiry_source=body.inquiry_source;
                details.pricing={...details.pricing,...body.pricing,version:2,discount:{...body.discount,amount:(body.discount.type==='percentage'?Number(body.pricing.base)*Number(body.discount.value)/100:body.discount.type==='fixed'?Number(body.discount.value):0).toFixed(2)}};
                reservation.total=(Object.values(body.pricing).reduce((sum,v)=>sum+Number(v),0)-Number(details.pricing.discount.amount)).toFixed(2);
                if (body.damages) details.damages=body.damages.map((record,index)=>({...record,id:record.id??index+1}));
                details.totals.damage_total=details.damages.reduce((sum,d)=>sum+Number(d.amount),0).toFixed(2);
                details.totals.amount_due=Math.max(0,Number(reservation.total)+Number(details.totals.damage_total)-Number(details.totals.paid)).toFixed(2);
                reservation.damage_total=details.totals.damage_total; reservation.amount_due=details.totals.amount_due;
            } else if (path.endsWith('/complete')) {
                reservation.status='completed'; reservation.completed_at=new Date().toISOString();
                details.capabilities={...details.capabilities,can_edit:false,can_manage_damages:false,can_complete:false};
            } else if (options.method==='POST') reservation.extension_access={enabled:true,agreed_deadline:body.agreed_deadline+'T23:59:59+08:00',granted_at:new Date().toISOString(),revoked_at:null,consumed_at:null};
            else reservation.extension_access={...reservation.extension_access,enabled:false,revoked_at:new Date().toISOString()};
            details.revision++; state.managedReservation=reservation;state.managedDetails=details;sessionStorage.setItem('rbms-admin-test',JSON.stringify(state));
            return json({reservation,details});
        }
        if (path === "/api/admin/reservations" && options.method === "GET") {
            if (state.dataError) return json({ message: "Test reservation service unavailable" }, 503);
            const search=(url.searchParams.get('search')??'').toLowerCase(), status=url.searchParams.get('status')??'', type=url.searchParams.get('type')??'';
            const filtered=records.filter(record=>(!search||record.reference.toLowerCase().includes(search)||record.contact_name.toLowerCase().includes(search))&&(!status||record.status===status)&&(!type||record.type===type));
            const page=Number(url.searchParams.get('page')||1), size=10, data=filtered.slice((page-1)*size,page*size);
            return json({data,total:filtered.length,current_page:page,last_page:Math.max(1,Math.ceil(filtered.length/size)),from:data.length?(page-1)*size+1:null,to:data.length?(page-1)*size+data.length:null,
                filters:{statuses:[...new Set(records.map(record=>record.status))],types:[...new Set(records.map(record=>record.type))]}});
        }
        if (path === "/api/admin/payment-reviews") {
            if (url.searchParams.get('scope') === 'all') {
                const label = reservation => {
                    const payments = reservation.payments ?? [];
                    if (payments.some(payment => payment.status === 'submitted')) return 'awaiting_review';
                    if (payments.some(payment => payment.status === 'approved')) return 'verified';
                    if (payments.some(payment => payment.status === 'rejected')) return 'rejected';
                    return 'not_paid';
                };
                const search = (url.searchParams.get('search') ?? '').toLowerCase();
                const status = url.searchParams.get('status') ?? '';
                const method = url.searchParams.get('method') ?? '';
                const summaries = records.map(record => {
                    const payments = [...(record.payments ?? [])].sort((a,b) => b.id-a.id);
                    const latest = payments[0];
                    return {
                        reservation_id:record.id, reservation_reference:record.reference, guest_name:record.contact_name,
                        starts_at:record.starts_at, ends_at:record.ends_at, payment_method:latest?.method ?? null,
                        total_submitted:payments.length ? payments.reduce((sum,payment) => sum+Number(payment.amount),0).toFixed(2) : null,
                        submitted_at:latest ? latest.submitted_at ?? new Date().toISOString() : null, status:label(record), latest_payment_id:latest?.id ?? null,
                        _payments:payments,
                    };
                }).filter(record => (!search || record.reservation_reference.toLowerCase().includes(search) || record.guest_name.toLowerCase().includes(search) || record._payments.some(payment => payment.reference.toLowerCase().includes(search)))
                    && (!status || record.status === status) && (!method || record._payments.some(payment => payment.method === method)));
                const page = Number(url.searchParams.get('page') || 1), size = 10, data = summaries.slice((page-1)*size,page*size).map(({_payments,...record}) => record);
                return json({data,total:summaries.length,current_page:page,last_page:Math.max(1,Math.ceil(summaries.length/size)),from:data.length?(page-1)*size+1:null,to:data.length?(page-1)*size+data.length:null,
                    filters:{statuses:[{value:'verified',label:'Verified'},{value:'not_paid',label:'Not Yet Paid'},{value:'awaiting_review',label:'Awaiting Review'},{value:'rejected',label:'Rejected'}],methods:['GCash','Bank']}});
            }
            const pending = records.flatMap(reservation => (reservation.payments ?? []).filter(payment => reservation.status === 'payment_review' && payment.status === 'submitted').map(payment => ({ reservation, payment }))).sort((a,b) => b.payment.id-a.payment.id);
            const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('per_page') || 25);
            return json({ data:pending.slice((page-1)*size, page*size), total:pending.length, current_page:page, last_page:Math.max(1,Math.ceil(pending.length/size)) });
        }
        if (/^\/api\/admin\/reservations\/\d+\/payment-review$/.test(path)) {
            if (state.paymentReviewRefreshError) return json({ message: "Payment review temporarily unavailable" }, 503);
            const record = records.find(r => r.id === Number(path.split('/')[4]));
            if (!record) return json({ message: "Not found" }, 404);
            const receipts = Object.fromEntries((record.payments ?? []).map(p => [p.id, { available: state.paymentReviewMode !== "missing", mime: state.paymentReviewMode === "pdf" ? "application/pdf" : "image/png" }]));
            return json({ reservation: record, receipts });
        }
        if (/^\/api\/admin\/reservations\/\d+\/payments\/\d+\/receipt$/.test(path)) {
            if (state.receiptError) return json({ message: "Receipt service unavailable" }, 503);
            if (state.paymentReviewMode === "missing") return json({ message: "Not found" }, 404);
            if (state.paymentReviewMode === "pdf") return new Response('%PDF-1.4\n%%EOF', { headers: { 'Content-Type': 'application/pdf' } });
            const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 600;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 600); ctx.fillStyle = '#4a3226'; ctx.font = 'bold 24px sans-serif';
            ctx.fillText('ISOLATED QA RECEIPT', 36, 70); ctx.font = '18px sans-serif'; ctx.fillText('Payment reference: PAYMENT-QA-1101', 36, 140); ctx.fillText('Submitted amount: PHP 5,000.00', 36, 190); ctx.fillText('Browser fixture only', 36, 260);
            return new Response(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), { headers: { 'Content-Type': 'image/png' } });
        }
        if (/^\/api\/admin\/reservations\/\d+\/payments\/\d+\/review$/.test(path) && options.method === "POST") {
            if (state.paymentReviewError) return json({ message: "This payment has already been reviewed or the reservation was cancelled." }, 422);
            const record = records.find(r => r.id === Number(path.split('/')[4]));
            const payment = record?.payments.find(p => p.id === Number(path.split('/')[6]));
            if (!payment) return json({ message: "Payment not found for this reservation" }, 404);
            const body = JSON.parse(options.body); payment.status = body.decision; payment.review_note = body.note; payment.reviewed_by = 1; payment.reviewed_at = new Date().toISOString();
            record.status = body.decision === 'approved' ? 'confirmed' : 'awaiting_deposit'; record.opportunity.status = body.decision === 'approved' ? 'completed' : 'active';
            record.deadline = new Date(Date.now() + 86400000).toISOString(); state.reviewRecord = record;
            if (state.failPaymentReviewRead) state.paymentReviewRefreshError = true;
            sessionStorage.setItem('rbms-admin-test', JSON.stringify(state));
            return json({ reservation: record });
        }
        if (path === "/api/admin/calendar") {
            if (state.calendarError) return json({ message: "Calendar service unavailable" }, 503);
            const start = url.searchParams.get("start"), end = url.searchParams.get("end");
            return json({ reservations: calendarRecords.filter(item => item.starts_at.slice(0, 10) < end && item.ends_at.slice(0, 10) >= start),
                blocks: blocks.filter(item => item.starts_on < end && item.ends_on > start) });
        }
        if (path === "/api/admin/availability-blocks" && options.method === "POST") {
            if (state.blockConflict) return json({ errors: { dates: ["These dates overlap another active commitment or blocked period."] } }, 422);
            const body = JSON.parse(options.body);
            const next = new Date(`${body.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
            const block = { id: 90, starts_on: body.date, ends_on: next.toISOString().slice(0, 10), reason: body.reason };
            blocks.push(block); state.calendarBlocks = blocks; sessionStorage.setItem("rbms-admin-test", JSON.stringify(state));
            return json({ block }, 201);
        }
        if (/^\/api\/admin\/availability-blocks\/\d+(\/release)?$/.test(path)) {
            const id = Number(path.split('/')[4]);
            const block = blocks.find(item => item.id === id);
            if (!block) return json({ message: "Not found" }, 404);
            if (options.method === "PATCH") block.reason = JSON.parse(options.body).reason;
            if (path.endsWith("/release")) blocks.splice(blocks.indexOf(block), 1);
            state.calendarBlocks = blocks; sessionStorage.setItem("rbms-admin-test", JSON.stringify(state));
            return json({ block, message: "Block released" });
        }
        if (path === "/api/settings") return json({ settings: {
            name: "Test Resort", contact: "Test contact", payment_instructions: "Test fixture only",
            weekday_rate: 16000, friday_saturday_rate: 22000, sunday_rate: 18000, special_rate: 22000,
            holiday_surcharge: 2000, standard_guests: 20, max_guests: 40, extra_guest_fee: 500,
            cleaning_fee: 1000, cleaning_threshold: 30, bonfire_price: 400, charcoal_price: 30,
            deposit: 5000, security_deposit: 3000, opportunity_hours: 24, min_lead_days: 2,
            special_dates: [], holiday_dates: [],
        }, payment_methods: state.paymentReviewMode ? [{ id:1, name:'GCash', account_name:'Isolated QA resort', account_number:'QA-TEST-ONLY', instructions:'Browser fixture only' }] : [] });
        if (path === "/auth/logout") {
            if (state.failLogout) return json({ message: "Test logout failed" }, 503);
            state.role = "anonymous";
            sessionStorage.setItem("rbms-admin-test", JSON.stringify(state));
            return new Response(null, { status: 204 });
        }
        if (path === "/api/reservations") {
            if (state.dataError) return json({ message: "Test reservation service unavailable" }, 503);
            if (state.dataExpired) { state.role = "anonymous"; return json({ message: "Unauthenticated" }, 401); }
            return json({ reservations: records });
        }
        if (/^\/api\/reservations\/\d+$/.test(path)) {
            if (state.detailsRefreshError) return json({ message: "Detail refresh unavailable" }, 503);
            const record = [...records, ...calendarRecords].find(item => item.id === Number(path.split("/").at(-1)));
            return record ? json({ reservation: record, ...(state.detailsMode || state.managementMode ? { details } : {}) }) : json({ message: "Not found" }, 404);
        }
        if (path === "/api/reservations/1/terms" && options.method === "PATCH") {
            if (state.detailsSaveError) return json({ message: "The total must cover the required deposit." }, 422);
            reservation.total = Number(JSON.parse(options.body).total).toFixed(2);
            if (state.failReadAfterSave) state.detailsRefreshError = true;
            return json({ reservation });
        }
        if (path === "/api/reservations/1/extension/review" && options.method === "POST") {
            reservation.extension_status = JSON.parse(options.body).decision;
            if (reservation.extension_status === "approved") reservation.deadline = reservation.extension_date + "T23:59:59+08:00";
            return json({ reservation });
        }
        if (path === "/api/admin/guests/2" && options.method === "PATCH") {
            if (state.guestUpdateError) return json({ message: "The given data was invalid.", errors: { email: ["The email has already been taken."] } }, 422);
            if (state.guestUpdateDelay) await new Promise(resolve => setTimeout(resolve, state.guestUpdateDelay));
            const body = JSON.parse(options.body);
            Object.assign(guest, body, { updated_at: new Date().toISOString() });
            state.guestRecord = guest;
            sessionStorage.setItem("rbms-admin-test", JSON.stringify(state));
            return json({ guest, reservation: guestReservation, reservations: [guestReservation], payments: [guestPayment], activity: [guestActivity] });
        }
        if (path === "/api/admin/guests") return json({ data: [guest], current_page: 1, last_page: 1, total: 1 });
        if (path === "/api/admin/guests/2") return json({ guest, reservation: guestReservation, reservations: [guestReservation], payments: [guestPayment], activity: [guestActivity] });
        if (path === "/api/admin/availability-blocks") return json({ data: [], current_page: 1, last_page: 1, total: 0 });
        return json({ message: "Test record not found" }, 404);
    };
}

try {
    let port;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
        if (launchError) throw launchError;
        try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
        catch { await delay(100); }
    }
    assert.ok(port, "Chrome did not expose a debugging port.");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    const runtimeErrors = [];
    let beforeUnloadDialogs = 0;
    let allowPageLeave = true;
    socket.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.method === "Page.javascriptDialogOpening" && message.params.type === "beforeunload") {
            beforeUnloadDialogs++;
            void cdp("Page.handleJavaScriptDialog", { accept: allowPageLeave });
        }
        if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
        if (message.method === "Fetch.requestPaused") {
            void cdp("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200,
                responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
                body: Buffer.from('{"status":"ok","message":"Isolated health fixture"}').toString("base64") }).catch(error => {
                    // StrictMode/navigation can abort the health request before fulfillment.
                    if (!error.message.includes("Invalid InterceptionId")) runtimeErrors.push(error.message);
                });
        }
        const request = pending.get(message.id);
        if (request) {
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
        }
    });
    function cdp(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
    }
    async function until(expression) {
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate(expression)) return;
            await delay(100);
        }
        throw new Error(`Condition timed out: ${expression}; URL: ${await evaluate("location.pathname + location.search")}`);
    }
    function passed(label) { checks++; console.log(`PASS ${label}`); }
    async function detailButton(label) {
        await evaluate(`(() => { const dialogs=[...document.querySelectorAll('.admin-reservation-detail dialog[open]')]; const root=dialogs.at(-1)??document.querySelector('.admin-reservation-detail'); [...root.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click(); })()`);
    }
    async function navigate(path) {
        const previous = await evaluate("window.__adminQA?.documentId");
        await cdp("Page.navigate", { url: base + path });
        await until(`Boolean(window.__adminQA) && window.__adminQA.documentId !== ${JSON.stringify(previous)}`);
    }
    async function visit(path, state = { role: "admin" }) {
        await evaluate(`sessionStorage.setItem('rbms-admin-test', ${JSON.stringify(JSON.stringify(state))})`);
        await navigate(path);
    }
    async function heading(title) {
        const expected = title === "Admin Dashboard" ? "Welcome back, Admin!" : title === "Calendar" ? "Centralized Calendar" : title === "Reservation details" ? "Reservation Details" : title === "Queue" ? "Reservations" : title === "Notifications" ? "Notification Center" : title;
        await until(`document.querySelector('h1')?.textContent === ${JSON.stringify(expected)}`);
    }
    async function snapshot(name) {
        if (!capture) return;
        await evaluate("Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]).then(() => true)");
        await until("[...document.images].every(image => image.complete && image.naturalWidth > 0)");
        await mkdir(screenshots, { recursive: true });
        const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(screenshots, `${name}.png`), Buffer.from(data, "base64"));
    }

    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/health", requestStage: "Request" }] });
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__ownerFixtureResponse=(${ownerFixtureResponse.toString()});(${installFixtures.toString()})();` });
    // Establish a same-origin document before setting per-test session fixtures.
    await cdp("Page.navigate", { url: base + "/admin/dashboard" });
    await until("Boolean(window.__adminQA)");
    if (process.argv.includes('--owner')) {
        await runOwnerChecks({ visit, navigate, evaluate, until, heading, passed, cdp, screenshot: snapshot, runtimeErrors });
    } else {
    if (!process.argv.includes('--reservation-management')) {
    await visit("/admin/dashboard", { role: "admin", delay: 1000 });
    await until("window.__adminQA?.requests.some(request => request.path === '/auth/user')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    await heading("Admin Dashboard");
    passed("Admin session allows dashboard; protected content stays hidden during validation");

    const roleChecks = await evaluate(`(async () => {
        const { loginDestination, readAuthenticatedUser } = await import('/src/types/auth.ts');
        const roles = ['admin', 'guest', 'owner', null, 'unknown'];
        return { destinations: roles.map(role => loginDestination({ role })),
            rejectsMalformed: readAuthenticatedUser({ user: { role: 'admin' } }) === null };
    })()`);
    assert.deepEqual(roleChecks.destinations, ["/admin/dashboard", "/", "/owner/dashboard", "/", "/"]);
    assert.equal(roleChecks.rejectsMalformed, true);
    passed("Confirmed-session login destinations preserve guest, owner and unknown roles");

    await until("Boolean(document.querySelector('.today-reservation'))");
    await evaluate(`
        window.__retainedDashboard = document.querySelector('.admin-dashboard');
        window.__authBefore = window.__adminQA.requests.filter(request => request.path === '/auth/user').length;
        window.__dataBefore = window.__adminQA.requests.filter(request => request.path === '/api/reservations').length;
        window.__sessionFlash = false;
        window.__mountObserver = new MutationObserver(() => {
            if (!window.__retainedDashboard.isConnected || document.body.textContent.includes('Checking your session')) window.__sessionFlash = true;
        });
        window.__mountObserver.observe(document.querySelector('#root'), { childList: true, subtree: true });
        window.__adminQA.state.delay = 600;
        window.__adminQA.state.adminName = 'Confirmed Admin';
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    `);
    await until("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__authBefore + 1");
    assert.ok(await evaluate("document.querySelector('.admin-dashboard') === window.__retainedDashboard && !document.body.textContent.includes('Checking your session')"));
    await evaluate("window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))");
    await until("document.querySelector('.admin-profile b')?.textContent === 'Confirmed Admin'");
    await delay(150);
    assert.equal(await evaluate("window.__sessionFlash"), false);
    assert.ok(await evaluate("document.querySelector('.admin-dashboard') === window.__retainedDashboard"));
    assert.ok(await evaluate("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__authBefore + 1"));
    assert.ok(await evaluate("window.__adminQA.requests.filter(request => request.path === '/api/reservations').length === window.__dataBefore"));
    assert.equal(await evaluate("location.pathname"), "/admin/dashboard");
    await evaluate("window.__mountObserver.disconnect()");
    passed("Background tab return stays mounted without a loading flash, duplicate checks or data refetch");

    await evaluate(`
        window.__authBefore = window.__adminQA.requests.filter(request => request.path === '/auth/user').length;
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
    `);
    await delay(150);
    assert.ok(await evaluate("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__authBefore"));
    await evaluate("delete document.visibilityState");
    passed("Hidden-tab events do not launch redundant session checks");

    await evaluate(`
        window.__retainedShell = document.querySelector('.admin-shell');
        window.__retainedHeader = document.querySelector('.admin-header');
        window.__retainedSidebar = document.querySelector('.admin-sidebar');
        window.__authBeforeNavigation = window.__adminQA.requests.filter(request => request.path === '/auth/user').length;
        window.__navigationFlash = false;
        window.__navigationObserver = new MutationObserver(() => {
            if (!window.__retainedShell.isConnected || !window.__retainedHeader.isConnected ||
                !window.__retainedSidebar.isConnected || document.body.textContent.includes('Checking your session')) window.__navigationFlash = true;
        });
        window.__navigationObserver.observe(document.querySelector('#root'), { childList: true, subtree: true });
    `);
    async function assertPersistentShell() {
        assert.equal(await evaluate("window.__navigationFlash"), false);
        assert.ok(await evaluate("document.querySelector('.admin-shell') === window.__retainedShell && document.querySelector('.admin-header') === window.__retainedHeader && document.querySelector('.admin-sidebar') === window.__retainedSidebar"));
        assert.ok(await evaluate("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__authBeforeNavigation"));
    }
    for (const [selector, path, title] of [
        ['.admin-sidebar a[href="/admin/reservations"]', "/admin/reservations", "Reservations"],
        ['#admin-content .admin-reservation-table tbody tr', "/admin/reservations/1", "Reservation details"],
        ['.admin-sidebar a[href="/admin/calendar"]', "/admin/calendar", "Calendar"],
        ['.admin-sidebar a[href="/admin/guests"]', "/admin/guests", "Guests"],
        ['#admin-content a[href="/admin/guests/2"]', "/admin/guests/2", "Guest Details"],
        ['.admin-sidebar a[href="/admin/reports"]', "/admin/reports", "Reports"],
        ['.admin-sidebar a[href="/admin/notifications"]', "/admin/notifications", "Notifications"],
        ['.admin-sidebar a[href="/admin/help"]', "/admin/help", "Help & Support"],
        ['.admin-sidebar a[href="/admin/dashboard"]', "/admin/dashboard", "Admin Dashboard"],
        ['#admin-content a[href="/admin/queue"]', "/admin/reservations", "Reservations"],
    ]) {
        await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await until(`location.pathname === ${JSON.stringify(path)}`);
        await heading(title);
        await assertPersistentShell();
        passed(`SPA navigation to ${path} keeps the shell mounted and makes no auth request`);
    }
    await evaluate("history.back()");
    await until("location.pathname === '/admin/dashboard'");
    await heading("Admin Dashboard");
    await assertPersistentShell();
    await evaluate("history.forward()");
    await until("location.pathname === '/admin/reservations' && location.search.includes('tab=queue-management')");
    await heading("Reservations");
    await assertPersistentShell();
    passed("Browser back/forward preserves the Admin shell without session checks");

    await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/reservations\"]').click()");
    await heading("Reservations");
    await assertPersistentShell();
    await evaluate("window.__navigationObserver.disconnect(); sessionStorage.setItem('rbms-admin-test', JSON.stringify({ role: 'admin', delay: 600 }))");
    const beforeNestedReload = await evaluate("window.__adminQA.documentId");
    await cdp("Page.reload");
    await until(`window.__adminQA?.documentId !== ${JSON.stringify(beforeNestedReload)} && Boolean(window.__adminQA)`);
    await until("window.__adminQA.requests.some(request => request.path === '/auth/user')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    assert.ok(await evaluate("document.body.textContent.includes('Checking your session')"));
    await heading("Reservations");
    passed("Hard refresh on a nested Admin route blocks the shell until Laravel session validation");
    await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/dashboard\"]').click()");
    await heading("Admin Dashboard");

    const beforeReload = await evaluate("window.__adminQA.documentId");
    await cdp("Page.reload");
    await until(`window.__adminQA?.documentId !== ${JSON.stringify(beforeReload)} && Boolean(window.__adminQA)`);
    await until("window.__adminQA.requests.some(request => request.path === '/auth/user')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    await heading("Admin Dashboard");
    assert.ok(await evaluate("window.__adminQA.requests.some(request => request.path === '/auth/user')"));
    passed("Refresh revalidates the session");

    await evaluate(`
        window.__adminQA.state.role = 'anonymous'; window.__adminQA.state.delay = 300;
        window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    `);
    await until("location.pathname === '/login'");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-dashboard'))"), false);
    passed("Expired background sessions clear the dashboard and redirect to login");

    await visit("/admin/dashboard", { role: "admin" });
    await heading("Admin Dashboard");
    await evaluate("window.__adminQA.state.role = 'guest'; window.dispatchEvent(new Event('focus'))");
    await until("location.pathname === '/'");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    passed("Background role revocation removes Admin access");

    await visit("/admin/dashboard", { role: "admin" });
    await heading("Admin Dashboard");
    await evaluate("window.__adminQA.state.sessionStatus = 403; window.dispatchEvent(new Event('focus'))");
    await until("location.pathname === '/login'");
    passed("Explicit background session rejection redirects to login");

    await visit("/admin/dashboard", { role: "admin" });
    await heading("Admin Dashboard");
    await evaluate("window.__adminQA.state.sessionError = true; window.dispatchEvent(new Event('focus'))");
    await until("Boolean(document.querySelector('[role=alert]'))");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    passed("Unverifiable background sessions fail closed");

    await visit("/admin/dashboard", { role: "admin" });
    await heading("Admin Dashboard");
    await evaluate(`
        window.__authBefore = window.__adminQA.requests.filter(request => request.path === '/auth/user').length;
        window.__adminQA.state.delay = 500; window.__adminQA.state.ignoreAuthAbort = true;
        window.dispatchEvent(new Event('focus'));
    `);
    await until("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__authBefore + 1");
    await evaluate("document.querySelector('[data-admin-signout]').click()");
    await until("location.pathname === '/login'");
    await delay(600);
    assert.equal(await evaluate("location.pathname"), "/login");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    passed("Late background responses cannot restore the Admin UI after logout");

    await visit("/admin");
    await until("location.pathname === '/admin/dashboard'");
    await heading("Admin Dashboard");
    passed("Admin index redirects to dashboard");

    runtimeErrors.length = 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1850, height: 1000, deviceScaleFactor: 1, mobile: false });
    await visit("/admin/dashboard", { role: "admin", dashboardMode: "populated" });
    await until("Boolean(document.querySelector('.today-reservation-content')) && Boolean(document.querySelector('.activity .panel-head'))");
    assert.ok(await evaluate("document.querySelector('.today-guest').textContent.includes('Marina Santos')"));
    assert.ok(await evaluate("document.querySelector('.today-facts').textContent.includes('Verified')"));
    assert.ok(await evaluate("document.querySelector('.activity .panel-head').textContent.includes('2 deposits awaiting review')"));
    assert.equal(await evaluate("document.querySelectorAll('.queue-preview tbody tr').length"), 2);
    assert.equal(await evaluate("document.querySelector('.admin-profile b').textContent"), "Test Admin");
    assert.equal(await evaluate("document.querySelector('.admin-header .admin-avatar').textContent"), "TA");
    assert.equal(await evaluate("document.querySelector('.today-reservation-content .btn').getAttribute('href')"), "/admin/reservations/10");
    assert.equal(await evaluate("document.querySelector('.activity-action').getAttribute('href')"), "/admin/reservations/21/payment-review?payment=902");
    assert.ok(await evaluate("document.querySelector('.upcoming-row').textContent.includes('Check-out')"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.admin-sidebar')).backgroundColor"), "rgb(51, 41, 31)");
    assert.equal(await evaluate("document.querySelector('.admin-sidebar').getBoundingClientRect().width"), 240);
    assert.equal(await evaluate("document.querySelector('.admin-header').getBoundingClientRect().height"), 72);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
    await snapshot("dashboard-desktop");
    passed("Populated dashboard uses authenticated profile, actual queue/payment states, working detail links and reference geometry");

    if (capture) {
        const { frameTree } = await cdp("Page.getFrameTree");
        await cdp("Page.setDocumentContent", { frameId: frameTree.frame.id, html: await readFile(join(screenshots, "reference.html"), "utf8") });
        await until("Boolean(document.querySelector('.portal.role-admin'))");
        await snapshot("figma-reference-desktop");
        passed("Original Figma Dashboard/Portal rendered for visual comparison");
    }

    await visit("/admin/dashboard", { role: "admin", dashboardMode: "empty" });
    await until("document.body.textContent.includes('No stay in progress')");
    assert.equal(await evaluate("document.querySelectorAll('.admin-dashboard .panel').length"), 4);
    assert.equal(await evaluate("document.querySelectorAll('.activity-action').length"), 0);
    assert.ok(await evaluate("document.body.textContent.includes('No upcoming confirmed check-ins or check-outs')"));
    await snapshot("dashboard-empty-desktop");
    passed("Empty dashboard preserves all panels without prototype bookings or payments");

    for (const width of [1024, 768, 375, 320]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width <= 760 });
        await visit("/admin/dashboard", { role: "admin", dashboardMode: "populated" });
        await until("Boolean(document.querySelector('.today-reservation-content'))");
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"), `Dashboard overflows at ${width}px`);
        if (width === 375) {
            await snapshot("dashboard-mobile");
            await evaluate("document.querySelector('.admin-menu-toggle').click()");
            assert.ok(await evaluate("document.querySelector('.admin-sidebar-open') !== null"));
            await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
            await until("document.querySelector('.admin-menu-toggle').getAttribute('aria-expanded') === 'false'");
        }
        passed(`Dashboard layout and navigation work at ${width}px`);
    }
    await until("[...document.images].every(image => image.complete && image.naturalWidth > 0)");
    assert.deepEqual(runtimeErrors, [], "Dashboard must not throw runtime exceptions");
    passed("Dashboard has no runtime exceptions or broken image assets");

    runtimeErrors.length = 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1850, height: 1650, deviceScaleFactor: 1, mobile: false });
    await visit("/admin/calendar", { role: "admin", calendarMode: "populated" });
    await heading("Calendar");
    await until("document.querySelectorAll('.calendar-grid .calendar-day').length === 42");
    assert.equal(await evaluate("document.querySelectorAll('.weekdays b').length"), 7);
    assert.ok(await evaluate("new Date(document.querySelector('.calendar-day').dataset.date + 'T12:00:00Z').getUTCDay() === 0"));
    assert.ok(await evaluate("document.querySelector('.current-date').dataset.date === window.__adminQA.today"));
    assert.ok(await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/calendar\"]').getAttribute('aria-current') === 'page'"));
    for (const category of ["confirmed-event", "completed-event", "temporary-hold-event", "queue-count-event", "blocked-event"]) {
        assert.ok(await evaluate(`Boolean(document.querySelector('.calendar-grid .${category}'))`));
    }
    assert.ok(await evaluate("document.querySelector('.calendar-grid a.temporary-hold-event').href.endsWith('/admin/reservations/42')"));
    assert.ok(await evaluate("document.querySelector('.calendar-grid a.queue-count-event').href.endsWith('/admin/queue')"));
    assert.ok(await evaluate("document.querySelector('.google-preview-column:first-child .temporary-hold-event') === null && document.querySelector('.google-preview-column:first-child .queue-count-event') === null"));
    assert.ok(await evaluate("document.querySelector('.google-preview-column:last-child .confirmed-event') === null"));
    await snapshot("calendar-desktop");
    passed("Centralized Calendar uses a current Sunday-first grid, actual categories and honest sync eligibility");

    if (capture) {
        const { frameTree } = await cdp("Page.getFrameTree");
        await cdp("Page.setDocumentContent", { frameId: frameTree.frame.id, html: await readFile(join(screenshots, "calendar-reference.html"), "utf8") });
        await until("document.querySelector('h1')?.textContent === 'Centralized Calendar'");
        await snapshot("figma-calendar-reference");
        await visit("/admin/calendar", { role: "admin", calendarMode: "populated" });
        await until("document.querySelectorAll('.calendar-grid .calendar-day').length === 42");
    }
    await evaluate("window.__calendarMonthTitle = document.querySelector('.calendar-head h2').textContent; document.querySelector('[aria-label=\"Next Month\"]').click()");
    await until("document.querySelector('.calendar-head h2').textContent !== window.__calendarMonthTitle && document.querySelectorAll('.calendar-day').length === 42");
    await evaluate("document.querySelector('.today-button').click()");
    await until("document.querySelector('.calendar-head h2').textContent === window.__calendarMonthTitle && Boolean(document.querySelector('.current-date'))");
    passed("Month navigation and Today work with real current dates");

    await evaluate("[...document.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Week').click()");
    await until("document.querySelectorAll('.calendar-grid.week-view .calendar-day').length === 7");
    await evaluate("[...document.querySelectorAll('.calendar-views button')].find(button => button.textContent === 'Day').click()");
    await until("document.querySelectorAll('.day-view .calendar-day').length === 1 && Boolean(document.querySelector('.day-schedule'))");
    passed("Week and Day are functional schedule views");

    await evaluate("document.querySelector('.admin-calendar .page-head .btn-primary').click()");
    await until("Boolean(document.querySelector('dialog[open].ocular-modal'))");
    assert.ok(await evaluate("document.querySelector('dialog').textContent.includes('separate from overnight reservations')"));
    assert.equal(await evaluate("document.querySelector('dialog form').checkValidity()"), false);
    assert.ok(await evaluate("document.querySelector('dialog .readonly-creator').textContent.includes('Test Admin')"));
    await snapshot("calendar-ocular-preview");
    await evaluate("document.querySelector('dialog .btn-ghost').click()");
    assert.ok(await evaluate("!window.__adminQA.requests.some(request => request.path.includes('ocular'))"));
    passed("Ocular form shows the authenticated creator, validates required fields, and cancels without a write");

    await evaluate("document.querySelector('.admin-calendar .page-head .btn-danger').click()");
    await until("Boolean(document.querySelector('dialog[open].block-modal form'))");
    async function fillBlock(reason, notes, date) {
        await evaluate(`(() => {
            const set = (selector, value, prototype) => {
                const input = document.querySelector(selector);
                Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            };
            set('dialog input:not([type=date])', ${JSON.stringify(reason)}, HTMLInputElement.prototype);
            set('dialog textarea', ${JSON.stringify(notes)}, HTMLTextAreaElement.prototype);
            ${date ? `set('dialog input[type=date]', ${JSON.stringify(date)}, HTMLInputElement.prototype);` : ""}
        })()`);
    }
    const blockDate = await evaluate("new Date(new Date(window.__adminQA.today + 'T12:00:00Z').getTime() + 5 * 86400000).toISOString().slice(0, 10)");
    await fillBlock("Browser Maintenance", "Test staff notes", blockDate);
    await evaluate("window.__adminQA.state.blockConflict = true; document.querySelector('dialog form').requestSubmit()");
    await until("document.querySelector('dialog [role=alert]')?.textContent.includes('overlap')");
    await snapshot("calendar-block-conflict");
    await evaluate("window.__adminQA.state.blockConflict = false; document.querySelector('dialog form').requestSubmit()");
    await until("!document.querySelector('dialog[open]') && [...document.querySelectorAll('.calendar-event.blocked-event')].some(event => event.textContent.includes('Browser Maintenance'))");
    const createRequest = await evaluate("window.__adminQA.requests.find(request => request.path === '/api/admin/availability-blocks' && request.method === 'POST')");
    assert.equal(createRequest.credentials, "include");
    assert.equal(createRequest.headers["X-CSRF-TOKEN"], "isolated-csrf-fixture");
    passed("Block form surfaces server conflicts and saves through credentialed CSRF-protected API calls");

    await evaluate("sessionStorage.setItem('rbms-admin-test', JSON.stringify({ ...window.__adminQA.state, delay: 400 }))");
    const beforeCalendarReload = await evaluate("window.__adminQA.documentId");
    await cdp("Page.reload");
    await until(`window.__adminQA?.documentId !== ${JSON.stringify(beforeCalendarReload)} && Boolean(window.__adminQA)`);
    await until("window.__adminQA.requests.some(request => request.path === '/auth/user')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    await heading("Calendar");
    await until("[...document.querySelectorAll('.calendar-event.blocked-event')].some(event => event.textContent.includes('Browser Maintenance'))");
    passed("Calendar hard refresh validates auth and reads the saved block again");

    await evaluate("[...document.querySelectorAll('.calendar-event.blocked-event')].find(event => event.textContent.includes('Browser Maintenance')).click()");
    await until("document.querySelector('dialog h2')?.textContent === 'Blocked Date Details'");
    assert.ok(await evaluate("document.querySelector('dialog').textContent.includes('Test staff notes')"));
    await evaluate("[...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Edit Block').click()");
    assert.equal(await evaluate("document.querySelector('dialog input[type=date]').readOnly"), true);
    await fillBlock("Updated Maintenance", "Updated staff notes");
    await evaluate("document.querySelector('dialog form').requestSubmit()");
    await until("!document.querySelector('dialog[open]') && [...document.querySelectorAll('.calendar-event.blocked-event')].some(event => event.textContent.includes('Updated Maintenance'))");
    await evaluate("[...document.querySelectorAll('.calendar-event.blocked-event')].find(event => event.textContent.includes('Updated Maintenance')).click()");
    await until("Boolean(document.querySelector('dialog[open]'))");
    await evaluate("[...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Remove Block').click()");
    await until("document.querySelector('dialog h2')?.textContent === 'Remove Block?'");
    await evaluate("document.querySelector('dialog .btn-danger').click()");
    await until("!document.querySelector('dialog[open]') && document.querySelectorAll('.calendar-day').length > 0 && ![...document.querySelectorAll('.calendar-event.blocked-event')].some(event => event.textContent.includes('Updated Maintenance'))");
    passed("Block details, notes editing and confirmed release update the calendar");

    await evaluate("window.__calendarHeader = document.querySelector('.admin-header'); window.__calendarAuth = window.__adminQA.requests.filter(request => request.path === '/auth/user').length; document.querySelector('.calendar-event.confirmed-event').click()");
    await heading("Reservation details");
    assert.ok(await evaluate("document.querySelector('.admin-header') === window.__calendarHeader"));
    await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/calendar\"]').click()");
    await heading("Calendar");
    await until("Boolean(document.querySelector('.calendar-grid'))");
    assert.ok(await evaluate("window.__adminQA.requests.filter(request => request.path === '/auth/user').length === window.__calendarAuth"));
    passed("Calendar event routing preserves the shared shell and session");

    for (const width of [1024, 375]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: width === 375 });
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
        if (width === 375) await snapshot("calendar-mobile");
        passed(`Calendar remains usable without page overflow at ${width}px`);
    }
    await visit("/admin/calendar", { role: "guest" });
    await until("location.pathname === '/'");
    await visit("/admin/calendar", { role: "anonymous" });
    await until("location.pathname === '/login'");
    passed("Guest and anonymous visitors cannot access the Centralized Calendar");
    await visit("/admin/calendar", { role: "admin", calendarError: true });
    await until("document.querySelector('.calendar [role=alert]')?.textContent.includes('Calendar service unavailable')");
    await evaluate("window.__adminQA.state.calendarError = false; document.querySelector('.calendar [role=alert] button').click()");
    await until("document.querySelectorAll('.calendar-day').length === 42");
    assert.deepEqual(runtimeErrors, [], "Calendar must not throw runtime exceptions");
    passed("Calendar API errors can be retried without runtime failures");

    runtimeErrors.length = 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1850, height: 2200, deviceScaleFactor: 1, mobile: false });
    await visit("/admin/reservations/1", { role: "admin", detailsMode: "populated", delay: 600 });
    await until("document.body.textContent.includes('Checking your session')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-reservation-detail'))"), false);
    await heading("Reservation Details");
    await until("Boolean(document.querySelector('.security-record'))");
    assert.equal(await evaluate("document.querySelector('.page-head p').textContent"), "Reservation ID · TEST-RESERVATION");
    for (const section of ["Guest Information", "Deposit Access Controls", "Stay Information", "Reservation Information", "Damage Records & Charges", "Editable Price Summary", "Discount Details", "Reservation Cost Summary", "Payments"]) {
        assert.ok(await evaluate(`[...document.querySelectorAll('.admin-reservation-detail h2, .admin-reservation-detail h3')].some(h => h.textContent === ${JSON.stringify(section)})`));
    }
    assert.ok(await evaluate("document.querySelector('.security-record strong').textContent.includes('2,500.00')"));
    assert.ok(await evaluate("document.querySelector('.cost-record').textContent.includes('1,000.50')"));
    assert.ok(await evaluate("document.querySelector('.table-wrap').textContent.includes('DETAIL-PENDING') && document.querySelector('.table-wrap').textContent.includes('Verified transfer')"));
    assert.ok(await evaluate("document.querySelector('.final-amount-due').textContent.includes('Unavailable')"));
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-reservation-detail button')].filter(b => ['Edit Reservation','Mark as Completed','Add Damage Record','Grant Access','Revoke','Manage in Deposit Review'].includes(b.textContent)).every(b => b.disabled)"));
    const detailGeometry = await evaluate("({ side:document.querySelector('.detail-side').getBoundingClientRect().width, main:document.querySelector('.detail-main').getBoundingClientRect().toJSON(), top:document.querySelector('.detail-side').getBoundingClientRect().top, overflow:document.documentElement.scrollWidth > innerWidth })");
    assert.equal(detailGeometry.side, 310); assert.equal(detailGeometry.main.top, detailGeometry.top); assert.equal(detailGeometry.overflow, false);
    await snapshot("reservation-details-desktop");
    passed("Details hard refresh waits for session; real reference, saved pricing, payment records and disabled unsupported actions match the detail layout");

    await evaluate("window.__printed = 0; window.print = () => window.__printed++; [...document.querySelectorAll('.admin-reservation-detail button')].find(b => b.textContent === 'Print Summary').click()");
    assert.equal(await evaluate("window.__printed"), 1);
    await cdp("Emulation.setEmulatedMedia", { media: "print" });
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.admin-header')).visibility"), "hidden");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.reservation-print-summary')).display"), "block");
    assert.ok(await evaluate("document.querySelector('.reservation-print-summary').textContent.includes('TEST-RESERVATION')"));
    await snapshot("reservation-details-print");
    await cdp("Emulation.setEmulatedMedia", { media: "" });
    passed("Print Summary invokes browser print and shows only the real reservation summary");

    if (capture) {
        const { frameTree } = await cdp("Page.getFrameTree");
        await cdp("Page.setDocumentContent", { frameId: frameTree.frame.id, html: await readFile(join(screenshots, "details-reference.html"), "utf8") });
        await snapshot("figma-details-reference");
    }
    await visit("/admin/reservations/1");
    await heading("Reservation Details");
    assert.equal(await evaluate("document.querySelector('.security-record strong').textContent"), "Not recorded");
    assert.ok(await evaluate("document.querySelector('.detail-main').textContent.includes('No payments submitted.')"));
    const documentId = await evaluate("window.__adminQA.documentId");
    await evaluate("document.querySelector('.back-link').click()"); await heading("Reservations");
    assert.equal(await evaluate("window.__adminQA.documentId"), documentId);
    passed("Missing pricing stays unavailable; empty payments and Back to Reservations work without document navigation");

    async function enterAgreedTotal(value) {
        await evaluate(`(() => { const el = [...document.querySelectorAll('.price-editor-grid label')].find(l => l.textContent.startsWith('Agreed Day Tour Total')).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }
    await visit("/admin/reservations/1", { role: "admin", detailsMode: "day_tour" }); await heading("Reservation Details");
    await detailButton("Edit Reservation");
    await enterAgreedTotal("4999.99"); await detailButton("Save Changes");
    await until("Boolean(document.querySelector('.field-error'))");
    assert.equal(await evaluate("window.__adminQA.requests.filter(r => r.path.endsWith('/terms')).length"), 0);
    await enterAgreedTotal("7250.50"); await detailButton("Save Changes");
    await until("Boolean(document.querySelector('dialog[open]'))");
    await evaluate("window.__adminQA.state.detailsSaveError = true"); await detailButton("Confirm");
    await until("document.querySelector('dialog [role=alert]')?.textContent.includes('cover')");
    assert.ok(await evaluate("document.querySelector('.updated-total').textContent.includes('16,000.00')"));
    await evaluate("window.__adminQA.state.detailsSaveError = false"); await detailButton("Confirm");
    await until("!document.querySelector('dialog[open]') && document.querySelector('.updated-total').textContent.includes('7,250.50')");
    const terms = await evaluate("window.__adminQA.requests.find(r => r.path.endsWith('/terms'))");
    assert.equal(terms.method, "PATCH"); assert.equal(terms.credentials, "include"); assert.equal(terms.headers['X-CSRF-TOKEN'], "isolated-csrf-fixture");
    assert.deepEqual(JSON.parse(terms.body), { total: "7250.50" });
    passed("Day-tour edit validates, confirms, preserves old totals on API rejection and rereads the saved total with session/CSRF transport");

    for (const [label, result] of [["Approve Extension", "approved"], ["Reject Extension", "rejected"]]) {
        await visit("/admin/reservations/1", { role: "admin", detailsMode: "extension" }); await heading("Reservation Details");
        await detailButton(label); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton("Confirm");
        await until(`!document.querySelector('dialog[open]') && [...document.querySelectorAll('.panel-head .badge')].some(b => b.textContent === '${result}')`);
        assert.equal(await evaluate("location.pathname"), "/admin/reservations/1");
    }
    passed("Extension approval/rejection use existing APIs and reread actual status on the same route");

    await visit("/admin/reservations/1", { role: "admin", detailsMode: "day_tour", failReadAfterSave: true }); await heading("Reservation Details");
    await detailButton("Edit Reservation"); await enterAgreedTotal("7500"); await detailButton("Save Changes");
    await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton("Confirm");
    await until("document.querySelector('.detail-error')?.textContent.includes('was saved') && !document.querySelector('dialog[open]')");
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-reservation-detail button')].find(b => b.textContent === 'Edit Reservation').disabled"));
    passed("Successful writes with failed rereads report the saved change and block stale follow-up edits");

    for (const role of ["guest", "anonymous"]) {
        await visit("/admin/reservations/1", { role });
        await until(`location.pathname === '${role === "guest" ? "/" : "/login"}'`);
        assert.equal(await evaluate("Boolean(document.querySelector('.admin-reservation-detail'))"), false);
    }
    passed("Direct reservation details remain inaccessible to guest and anonymous visitors");

    for (const width of [1024, 768, 375]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1300, deviceScaleFactor: 1, mobile: width === 375 });
        await visit("/admin/reservations/1", { role: "admin", detailsMode: "populated" }); await heading("Reservation Details");
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
        if (width <= 1000) assert.ok(await evaluate("document.querySelector('.detail-side').getBoundingClientRect().top >= document.querySelector('.detail-main').getBoundingClientRect().bottom"));
        await snapshot(`reservation-details-${width}`);
    }
    assert.deepEqual(runtimeErrors, []);
    passed("Details stack summaries and fit tablet/mobile widths without runtime failures");

    runtimeErrors.length = 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1850, height: 1600, deviceScaleFactor: 1, mobile: false });
    const reviewBase = { role: "admin", paymentReviewMode: "pending" };
    async function reviewButton(label) {
        await evaluate(`[...document.querySelectorAll('.admin-payment-review button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
    }
    async function reviewReady() {
        await heading("Deposit Verification");
        await until("[...document.querySelectorAll('.admin-payment-review button')].some(b => b.textContent === 'Approve Payment' && !b.disabled)");
    }
    await visit("/admin/reservations/1/payment-review", { ...reviewBase, delay: 600 });
    await until("document.body.textContent.includes('Checking your session')");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-payment-review'))"), false);
    await reviewReady();
    assert.ok(await evaluate("document.querySelector('.payment-reservation-reference').textContent.includes('TEST-RESERVATION')"));
    assert.ok(await evaluate("document.querySelector('.admin-payment-review').textContent.includes('PAYMENT-QA-1101')"));
    assert.ok(await evaluate("document.querySelector('.receipt-preview img').naturalWidth > 0 && getComputedStyle(document.querySelector('.receipt-preview img')).objectFit === 'contain'"));
    assert.ok(await evaluate("document.querySelector('.receipt-preview a').href.startsWith('blob:')"));
    await snapshot("payment-review-desktop");
    passed("Payment review direct refresh waits for Admin session, displays the actual submission and securely previews receipt bytes");

    await reviewButton("Approve Payment"); await until("Boolean(document.querySelector('dialog[open]'))");
    await reviewButton("Cancel"); assert.equal(await evaluate("window.__adminQA.requests.filter(r => r.path.endsWith('/review') && r.method === 'POST').length"), 0);
    await reviewButton("Approve Payment"); await until("Boolean(document.querySelector('dialog[open]'))");
    await evaluate("window.__adminQA.state.paymentReviewError = true"); await reviewButton("Confirm Approval");
    await until("document.querySelector('dialog [role=alert]')?.textContent.includes('already been reviewed')");
    assert.ok(await evaluate("document.querySelector('.payment-review-side').textContent.includes('Awaiting Review')"));
    await evaluate("window.__adminQA.state.paymentReviewError = false"); await reviewButton("Confirm Approval");
    await until("document.querySelector('.payment-success')?.textContent.includes('confirmed and secured') && !document.querySelector('dialog[open]')");
    const paymentWrite = await evaluate("window.__adminQA.requests.find(r => r.path === '/api/admin/reservations/1/payments/1101/review')");
    assert.equal(paymentWrite.method, 'POST'); assert.equal(paymentWrite.credentials, 'include'); assert.equal(paymentWrite.headers['X-CSRF-TOKEN'], 'isolated-csrf-fixture');
    assert.equal(JSON.parse(paymentWrite.body).decision, 'approved');
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-payment-review button')].filter(b => ['Approve Payment','Reject Payment'].includes(b.textContent)).every(b => b.disabled)"));
    await snapshot("payment-review-approved");
    passed("Approval confirms, handles backend rejection without fake updates, uses CSRF/cookies and rereads verified state");

    const reviewDocument = await evaluate("window.__adminQA.documentId");
    await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/dashboard\"]').click()"); await heading("Admin Dashboard");
    await until("document.querySelector('.activity')?.textContent.includes('No deposits awaiting review')");
    assert.equal(await evaluate("window.__adminQA.documentId"), reviewDocument);
    await navigate('/admin/reservations/1'); await heading('Reservation Details');
    assert.ok(await evaluate("document.querySelector('.table-wrap').textContent.includes('Verified') && document.querySelector('.cost-record').textContent.includes('5,000.00')"));
    await navigate('/admin/calendar'); await heading('Calendar');
    await until("Boolean(document.querySelector('.calendar-event.confirmed-event'))");
    passed("Approved submissions disappear from Dashboard review and appear verified in Details and secured in Calendar");

    await visit('/admin/dashboard', reviewBase); await heading('Admin Dashboard');
    await until("Boolean(document.querySelector('.activity-action'))");
    await evaluate("document.querySelector('.activity-action').click()"); await reviewReady();
    assert.equal(await evaluate('location.pathname'), '/admin/reservations/1/payment-review');
    await evaluate("document.querySelector('.back-link').click()"); await heading('Reservations');
    await until("Boolean(document.querySelector('.admin-deposit-table tbody tr'))");
    assert.equal(await evaluate('location.search'), '?tab=deposit-review');
    await evaluate("document.querySelector('.admin-deposit-table tbody tr').click()"); await reviewReady();
    await reviewButton('Reject Payment'); await until("Boolean(document.querySelector('dialog[open]'))");
    await evaluate("(() => { const input=document.querySelector('#rejection-reason'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'   '); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await evaluate("document.querySelector('dialog form').requestSubmit()");
    await until("document.querySelector('dialog [role=alert]')?.textContent.includes('rejection reason')");
    assert.equal(await evaluate("window.__adminQA.requests.filter(r => r.path.endsWith('/review') && r.method === 'POST').length"), 0);
    await evaluate("(() => { const input=document.querySelector('#rejection-reason'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Receipt is unreadable. Please submit a clear proof.'); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await reviewButton('Confirm Rejection');
    await until("document.querySelector('.payment-success')?.textContent.includes('Payment rejected') && !document.querySelector('dialog[open]')");
    assert.ok(await evaluate("document.querySelector('.payment-history-list').textContent.includes('Receipt is unreadable')"));
    assert.ok(await evaluate("document.querySelector('.payment-review-main').textContent.includes('Awaiting Deposit')"));
    await snapshot('payment-review-rejected');
    passed("Dashboard and filtered list open dedicated review; rejection requires a reason and preserves proof/history with renewed deposit state");

    await evaluate("window.__adminQA.state.role = 'guest'; window.__adminQA.state.accountId=2; sessionStorage.setItem('rbms-admin-test', JSON.stringify(window.__adminQA.state))");
    await navigate('/dashboard'); await until("document.querySelector('h1')?.textContent.startsWith('Welcome,')");
    await until("document.body.textContent.includes('Receipt is unreadable')");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('View Reservation Details')).click()");
    await until("document.body.textContent.includes('Payment proof rejected.')");
    assert.ok(await evaluate("document.body.textContent.includes('Previously submitted transfer references cannot be reused')"));
    passed("Customer refresh displays the rejection reason and keeps the existing proof resubmission flow");

    for (const mode of ['mismatch','missing','pdf','none']) {
        await visit('/admin/reservations/1/payment-review', { role:'admin', paymentReviewMode:mode }); await heading('Deposit Verification');
        if (mode === 'pdf') { await until("Boolean(document.querySelector('.pdf-receipt'))"); assert.ok(await evaluate("document.querySelector('.receipt-preview a').textContent.includes('Open full receipt')")); }
        else {
            await until("Boolean(document.querySelector('.payment-review-side'))");
            assert.ok(await evaluate("[...document.querySelectorAll('.admin-payment-review button')].find(b=>b.textContent==='Approve Payment').disabled"));
            if (mode === 'missing') assert.ok(await evaluate("document.querySelector('.receipt-preview').textContent.includes('No payment receipt submitted.')"));
            if (mode === 'mismatch') assert.ok(await evaluate("document.querySelector('.verification-warning').textContent.includes('below the minimum required deposit')"));
        }
        await snapshot(`payment-review-${mode}`);
    }
    passed("Mismatched and missing proofs cannot be approved; PDF and no-submission states remain usable");

    await visit('/admin/reservations/1/payment-review', { ...reviewBase, receiptError:true }); await heading('Deposit Verification');
    await until("document.querySelector('.receipt-preview [role=alert]')?.textContent.includes('Unable to load')");
    await evaluate("window.__adminQA.state.receiptError=false"); await reviewButton('Retry receipt'); await reviewReady();
    await visit('/admin/reservations/1/payment-review', { ...reviewBase, failPaymentReviewRead:true }); await reviewReady();
    await reviewButton('Approve Payment'); await until("Boolean(document.querySelector('dialog[open]'))"); await reviewButton('Confirm Approval');
    await until("document.querySelector('.payment-error')?.textContent.includes('decision was saved')");
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-payment-review button')].find(b=>b.textContent==='Approve Payment').disabled"));
    passed("Receipt load failures retry safely; failed rereads after saved decisions block stale reviews");

    for (const width of [1024, 768, 375, 320]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height:1500, deviceScaleFactor:1, mobile:width<=375 });
        await visit('/admin/reservations/1/payment-review', reviewBase); await reviewReady();
        assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
        await snapshot(`payment-review-${width}`);
    }
    for (const role of ['guest','owner','anonymous']) {
        await visit('/admin/reservations/1/payment-review', {role}); await until(`location.pathname === '${role === 'anonymous' ? '/login' : role === 'owner' ? '/owner/dashboard' : '/'}'`);
        assert.equal(await evaluate("Boolean(document.querySelector('.admin-payment-review'))"), false);
    }
    assert.deepEqual(runtimeErrors, []);
    passed('Payment review fits desktop/tablet/mobile widths and denies non-Admin sessions without runtime errors');

    for (const width of [1850, 375]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 375 });
        await visit("/admin/reservations", { role: "admin", dashboardMode: "populated" });
        await heading("Reservations");
        await until("Boolean(document.querySelector('.admin-reservation-table tbody tr'))");
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.admin-reservation-table th')].map(h=>h.textContent)"), ["Reservation ID", "Guest", "Requested Date", "Guests", "Deposit", "Status"]);
        assert.ok(await evaluate("[...document.querySelectorAll('.admin-reservation-table tbody tr')].every(row=>row.tabIndex===0&&row.cells.length===6)"));
        assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
        await evaluate("[...document.querySelectorAll('.admin-reservation-table tbody tr')].find(row=>row.textContent.includes('TEST-REVIEW-21')).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
        await heading("Reservation Details");
        assert.equal(await evaluate("location.pathname"), "/admin/reservations/21");
    }
    passed("Reservation table displays the current operational columns and opens rows by keyboard at desktop/mobile widths");

    for (const width of [1850, 375]) {
        await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width === 375 });
        await visit("/admin/reservations?tab=deposit-review", { role: "admin", dashboardMode: "populated" }); await heading("Reservations");
        await until("Boolean(document.querySelector('.admin-deposit-table tbody'))");
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.admin-deposit-table th')].map(th => th.textContent)"), ["Reservation ID", "Guest", "Stay Dates", "Payment Method", "Total Submitted", "Submitted At", "Status"]);
        assert.equal(await evaluate("document.querySelectorAll('.admin-deposit-table tbody tr').length"), 6);
        assert.ok(await evaluate("[...document.querySelectorAll('.admin-deposit-table tbody tr')].every(row => row.cells.length === 7 && !row.querySelector('a') && row.tabIndex === 0 && getComputedStyle(row).cursor === 'pointer')"));
        assert.ok(await evaluate("document.querySelector('.deposit-records-header').textContent.includes('All Deposit Payment Records') && document.querySelector('.deposit-records-footer').textContent.includes('1–6 of 6')"));
        await evaluate("document.querySelector('.admin-deposit-table tbody tr').focus(); document.querySelector('.admin-deposit-table tbody tr').scrollIntoView({block:'center',inline:'nearest'})");
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
        await snapshot(`deposit-review-records-${width}`);
        await evaluate("[...document.querySelectorAll('.admin-deposit-table tbody tr')].find(row => row.textContent.includes('TEST-REVIEW-21')).click()"); await heading("Deposit Verification");
        assert.equal(await evaluate("location.pathname + location.search"), "/admin/reservations/21/payment-review?payment=902");
    }
    await visit("/admin/reservations?tab=deposit-review", { role: "admin", dashboardMode: "populated" }); await until("Boolean(document.querySelector('.admin-deposit-table tbody'))");
    await fillEditor('.deposit-review-search input', 'Nico');
    await until("document.querySelectorAll('.admin-deposit-table tbody tr').length === 1");
    assert.ok(await evaluate("location.search.includes('search=Nico') && document.querySelector('.deposit-records-footer').textContent.includes('1–1 of 1')"));
    await evaluate("document.querySelector('.admin-deposit-table tbody tr').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"); await heading("Deposit Verification");
    assert.equal(await evaluate("location.pathname + location.search"), "/admin/reservations/21/payment-review?payment=902");
    passed("Deposit Review shows all reservation payment records, filters by search, remains responsive, and opens rows by pointer or keyboard");

    }
    runtimeErrors.length = 0;
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1850, height: 2200, deviceScaleFactor: 1, mobile: false });
    const managementState = mode => ({ role:'admin', managementMode:mode });
    async function fillEditor(selector, value) {
        await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true})); })()`);
    }
    async function fillCharge(label, value, root='.price-editor-grid') {
        await evaluate(`(() => { const input=[...document.querySelectorAll(${JSON.stringify(root+' label')})].find(l=>l.textContent.startsWith(${JSON.stringify(label)})).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }
    await visit('/admin/reservations/1', managementState('future')); await heading('Reservation Details');
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-reservation-detail button')].find(b=>b.textContent==='Mark as Completed').disabled"));
    await detailButton('Edit Reservation');
    await fillEditor('[name=contact_name]','Unsaved Booking Name'); await detailButton('Cancel');
    assert.equal(await evaluate("window.__adminQA.requests.filter(r=>r.method==='PATCH').length"),0);
    assert.ok(await evaluate("document.querySelector('.detail-main').textContent.includes('Test Guest') && !document.querySelector('.detail-main').textContent.includes('Unsaved Booking Name')"));
    await detailButton('Edit Reservation');
    await fillEditor('[name=contact_name]','Updated Booking Guest'); await fillEditor('[name=contact_address]','Updated booking address');
    await fillCharge('Base Reservation Price','20000'); await fillEditor('[name="discount.type"]','percentage'); await fillEditor('[name="discount.value"]','10');
    await detailButton('Save Changes'); await until("document.querySelector('[role=alert]')?.textContent.includes('justification')");
    assert.equal(await evaluate("Boolean(document.querySelector('dialog[open]'))"),false);
    await fillEditor('[name="discount.justification"]','Returning customer rate approved.');
    await snapshot('reservation-details-editing');
    await detailButton('Save Changes'); await until("document.querySelector('dialog h2')?.textContent==='Update Reservation?'");
    await detailButton('Cancel'); assert.equal(await evaluate("window.__adminQA.requests.filter(r=>r.method==='PATCH').length"),0);
    await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))");
    await evaluate("window.__adminQA.state.managementConflict=true"); await detailButton('Confirm Update');
    await until("document.querySelector('dialog [role=alert]')?.textContent.includes('overlap')");
    assert.equal(await evaluate("Boolean(window.__adminQA.state.managedReservation)"),false);
    await evaluate("window.__adminQA.state.managementConflict=false"); await detailButton('Confirm Update');
    await until("document.querySelector('.detail-success')?.textContent==='Reservation updated successfully.'");
    assert.ok(await evaluate("document.querySelector('.detail-main').textContent.includes('Updated Booking Guest') && document.querySelector('.updated-total').textContent.includes('19,390.00')"));
    const bookingWrite=await evaluate("window.__adminQA.requests.find(r=>r.path==='/api/admin/reservations/1' && r.method==='PATCH')");
    assert.equal(bookingWrite.credentials,'include'); assert.equal(bookingWrite.headers['X-CSRF-TOKEN'],'isolated-csrf-fixture');
    assert.equal(JSON.parse(bookingWrite.body).revision,0); assert.equal('total' in JSON.parse(bookingWrite.body),false); assert.equal('payments' in JSON.parse(bookingWrite.body),false);
    assert.ok(await evaluate("document.querySelector('.table-wrap').textContent.includes('MANAGEMENT-VERIFIED')"));
    await navigate('/admin/reservations/1'); await heading('Reservation Details');
    assert.ok(await evaluate("document.querySelector('.detail-main').textContent.includes('Updated Booking Guest')"));
    passed('Confirmed booking edit supports real fields, cancel/confirmation, discount validation, backend errors and server-confirmed pricing without payment mutation');

    await detailButton('Edit Reservation'); await fillEditor('[name=contact_name]','Unsaved navigation test');
    await evaluate("document.querySelector('.back-link').click()"); await until("document.querySelector('dialog h2')?.textContent==='Unsaved Reservation Changes'");
    await detailButton('Continue Editing'); assert.equal(await evaluate('location.pathname'),'/admin/reservations/1');
    const point=await evaluate("(() => { const input=document.querySelector('[name=contact_name]'); input.scrollIntoView({block:'center'}); const r=input.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
    await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point}); await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    const unloadCount=beforeUnloadDialogs; const unsavedDocument=await evaluate('window.__adminQA.documentId'); allowPageLeave=false;
    await cdp('Page.reload');
    for (let i=0;i<30 && beforeUnloadDialogs===unloadCount;i++) await delay(100);
    assert.ok(beforeUnloadDialogs>unloadCount,'Dirty reservation reload should trigger beforeunload');
    assert.equal(await evaluate('window.__adminQA.documentId'),unsavedDocument); allowPageLeave=true;
    await evaluate("document.querySelector('.admin-sidebar a[href=\"/admin/dashboard\"]').click()"); await until("document.querySelector('dialog h2')?.textContent==='Unsaved Reservation Changes'");
    await detailButton('Discard and Leave'); await heading('Admin Dashboard');
    passed('Unsaved changes guard covers Back, sidebar navigation and browser refresh, with continue/discard choices');

    await visit('/admin/reservations/1',managementState('ongoing')); await heading('Reservation Details'); await detailButton('Edit Reservation');
    assert.ok(await evaluate("![...document.querySelectorAll('.admin-reservation-detail button')].find(b=>b.textContent==='Add Damage Record').disabled"));
    await detailButton('Add Damage Record'); await fillCharge('Damage Description','Broken poolside chair','.damage-record-fields'); await fillCharge('Item or Area Damaged','Poolside','.damage-record-fields'); await fillCharge('Amount Charged','1200','.damage-record-fields');
    await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Update'); await until("Boolean(document.querySelector('.detail-success'))");
    assert.ok(await evaluate("document.querySelector('.damage-totals').textContent.includes('1,200.00') && document.querySelector('.final-amount-due').textContent.includes('12,590.00')"));
    await detailButton('Edit Reservation'); await fillCharge('Amount Charged','500','.damage-record-fields');
    await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Update'); await until("!document.querySelector('dialog[open]')");
    await snapshot('reservation-details-damages');
    await detailButton('Mark as Completed'); await until("document.querySelector('dialog h2')?.textContent==='Confirm Completed Staycation?'"); await detailButton('Confirm Completion');
    await until("document.querySelector('.detail-success')?.textContent.includes('completed successfully')");
    assert.ok(await evaluate("[...document.querySelectorAll('.admin-reservation-detail button')].filter(b=>['Edit Reservation','Add Damage Record','Mark as Completed'].includes(b.textContent)).every(b=>b.disabled)"));
    assert.ok(await evaluate("document.querySelector('.damage-record-list').textContent.includes('Damage Record 1') && document.querySelector('.table-wrap').textContent.includes('MANAGEMENT-VERIFIED')"));
    await fillEditor('[aria-label="Print summary type"]','checkout');
    await evaluate("window.__checkoutPrint=0; window.print=()=>window.__checkoutPrint++"); await detailButton('Print Summary'); assert.equal(await evaluate('window.__checkoutPrint'),1);
    assert.ok(await evaluate("document.querySelector('.reservation-print-summary').textContent.includes('Check-out Summary') && document.querySelector('.reservation-print-summary').textContent.includes('Broken poolside chair')"));
    passed('Ongoing damage records save/edit with payment-adjusted totals; completion persists and locks records while preserving checkout print data');

    await visit('/admin/reservations/1',managementState('ongoing')); await heading('Reservation Details'); await detailButton('Edit Reservation'); await detailButton('Add Damage Record');
    await fillCharge('Damage Description','Remove draft test','.damage-record-fields'); await fillCharge('Item or Area Damaged','Poolside','.damage-record-fields'); await fillCharge('Amount Charged','100','.damage-record-fields');
    await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Update'); await until("!document.querySelector('dialog[open]')");
    await detailButton('Edit Reservation'); await detailButton('Remove'); await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Update'); await until("!document.querySelector('dialog[open]')");
    assert.ok(await evaluate("document.querySelector('.damage-empty').textContent.includes('No damage has been recorded')"));
    passed('Damage removal is submitted with the reservation update and the refreshed history is shown');

    await visit('/admin/reservations/1',managementState('unpaid')); await heading('Reservation Details');
    const actualDeadline=await evaluate("document.querySelector('.access-control-panel').textContent.match(/Current Deposit Deadline[^]+/)[0]");
    const agreed=await evaluate("new Date(Date.now()+3*86400000).toISOString().slice(0,10)"); await fillEditor('#agreed-extension',agreed); await detailButton('Grant Access');
    await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Grant'); await until("document.querySelector('.detail-success')?.textContent.includes('access granted')");
    assert.equal(await evaluate("document.querySelector('.access-control-panel').textContent.match(/Current Deposit Deadline[^]+/)[0]"),actualDeadline);
    await detailButton('Revoke'); await until("Boolean(document.querySelector('dialog[open]'))"); await detailButton('Confirm Revoke'); await until("document.querySelector('.detail-success')?.textContent.includes('access revoked')");
    passed('Extension grants/revocations persist per reservation without changing the actual deadline');

    await visit('/admin/reservations/1',managementState('future')); await heading('Reservation Details'); await detailButton('Edit Reservation'); await fillEditor('[name=contact_name]','Stale booking attempt');
    await detailButton('Save Changes'); await until("Boolean(document.querySelector('dialog[open]'))"); await evaluate("window.__adminQA.state.managementStale=true"); await detailButton('Confirm Update');
    await until("document.querySelector('[role=alert]')?.textContent.includes('another session')");
    await detailButton('Reload latest details'); await until("![...document.querySelectorAll('.admin-reservation-detail button')].some(b=>b.textContent==='Save Changes')");
    assert.ok(await evaluate("!document.querySelector('.detail-main').textContent.includes('Stale booking attempt')"));
    passed('Stale revisions block writes and offer a reload of server-confirmed data');

    for (const width of [1850,1024,375]) {
        await cdp('Emulation.setDeviceMetricsOverride',{width,height:1800,deviceScaleFactor:1,mobile:width===375});
        await visit('/admin/reservations/1',managementState('future')); await heading('Reservation Details'); await detailButton('Edit Reservation');
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth')); await snapshot(`reservation-details-functional-${width}`); await detailButton('Cancel');
    }
    assert.deepEqual(runtimeErrors,[]); passed('Functional editor keeps Figma card geometry and works on desktop/tablet/mobile without runtime errors');

    await cdp('Emulation.setDeviceMetricsOverride',{width:1850,height:1200,deviceScaleFactor:1,mobile:false});
    const guestAccessDate=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
    await visit('/dashboard',{role:'guest',accountId:2,managementMode:'unpaid',managedReservation:{extension_access:{enabled:true,agreed_deadline:guestAccessDate+'T23:59:59+08:00',consumed_at:null}}});
    await until("document.querySelector('h1')?.textContent.startsWith('Welcome,')");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='My Reservations').click()");
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Request Deadline Extension')");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Request Deadline Extension').click()");
    await until("Boolean(document.querySelector('[role=dialog]'))");
    assert.equal(await evaluate("document.querySelector('[role=dialog] input[type=date]').max"),guestAccessDate);
    passed('Customer extension request appears only with authorized access and respects the agreed date limit');

    await visit('/dashboard',{role:'guest',accountId:2,managementMode:'ongoing',managedDetails:{totals:{damage_total:'500.00',paid:'5000.00',amount_due:'11890.00',credit_balance:'0.00'}}});
    await until("document.querySelector('h1')?.textContent.startsWith('Welcome,')");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='My Reservations').click()");
    await until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='View Payment History')");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Request Deadline Extension').length"),0);
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='View Payment History').click()");
    await until("document.body.textContent.includes('Recorded damage charges')");
    assert.ok(await evaluate("document.body.textContent.includes('11,890.00')"));
    passed('Customer payment summary includes persisted damages in the remaining balance without exposing unauthorized extension controls');

    await visit('/admin/guests?search=Test&page=1', { role: 'admin' });
    await heading('Guests');
    await until(`Boolean(document.querySelector('#admin-content a[href="/admin/guests/2"]'))`);
    assert.equal(await evaluate("document.querySelector('.admin-guest-search input').value"), 'Test');
    await evaluate(`document.querySelector('#admin-content a[href="/admin/guests/2"]').click()`);
    await heading('Guest Details');
    await until("Boolean(document.querySelector('.admin-guest-profile-card'))");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Edit Guest').click()");
    assert.equal(await evaluate("document.querySelector('[name=name]').value"), 'Test Guest');
    assert.equal(await evaluate("document.querySelector('[name=address]').value"), 'Test address');
    await fillEditor('[name=name]', 'Discarded Guest Name');
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Cancel').click()");
    assert.ok(await evaluate("document.querySelector('.admin-guest-profile-card').textContent.includes('Test Guest') && !document.querySelector('.admin-guest-profile-card').textContent.includes('Discarded Guest Name')"));
    assert.equal(await evaluate("window.__adminQA.requests.filter(request=>request.path==='/api/admin/guests/2' && request.method==='PATCH').length"), 0);

    await evaluate("window.__adminQA.state.guestUpdateError=true; [...document.querySelectorAll('button')].find(button=>button.textContent==='Edit Guest').click()");
    await fillEditor('[name=email]', 'duplicate@example.test');
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Save Changes').click()");
    await until("document.querySelector('#guest-email-error')?.textContent.includes('already been taken')");
    assert.ok(await evaluate("Boolean(document.querySelector('[name=email][aria-invalid=true]'))"));

    await evaluate("window.__adminQA.state.guestUpdateError=false; window.__adminQA.state.guestUpdateDelay=200");
    await fillEditor('[name=name]', 'Updated Guest');
    await fillEditor('[name=email]', 'updated@example.test');
    await fillEditor('[name=phone]', '09171234567');
    await fillEditor('[name=address]', 'Updated profile address');
    await fillEditor('[name=account_status]', 'inactive');
    await evaluate("(() => { const button=[...document.querySelectorAll('button')].find(item=>item.textContent==='Save Changes'); button.click(); button.click(); })()");
    await until("[...document.querySelectorAll('button')].some(button=>button.textContent==='Edit Guest')");
    assert.equal(await evaluate("window.__adminQA.requests.filter(request=>request.path==='/api/admin/guests/2' && request.method==='PATCH').length"), 2);
    assert.ok(await evaluate("document.querySelector('.admin-guest-profile-card').textContent.includes('Updated Guest') && document.querySelector('.admin-guest-profile-card').textContent.includes('Updated profile address') && document.querySelector('.admin-guest-profile-card').textContent.includes('Inactive')"));
    await evaluate("document.querySelector('.admin-guest-back').click()");
    await heading('Guests');
    assert.equal(await evaluate("location.search"), '?search=Test&page=1');
    await until("document.querySelector('.admin-guests-table')?.textContent.includes('Updated Guest')");
    passed('Guest editing prefills values, cancels safely, maps field errors, blocks duplicate saves, refreshes the list, and preserves search/page state');

    for (const [path, title] of [
        ["reservations", "Reservations"], ["reservations/1", "Reservation details"], ["queue", "Queue"],
        ["calendar", "Calendar"], ["guests", "Guests"], ["guests/2", "Guest Details"],
        ["guests/2/reservations", "Guest Reservations"], ["guests/2/payments", "Payment History"], ["guests/2/activity", "Guest Activity"], ["reports", "Reports"],
        ["notifications", "Notifications"], ["help", "Help & Support"], ["missing", "Page not found"],
    ]) {
        await visit(`/admin/${path}`);
        await heading(title);
        await until("!document.querySelector('#admin-content [role=status]')");
        assert.equal(await evaluate("Boolean(document.querySelector('#admin-content [role=alert]'))"), false);
        passed(`Admin route /admin/${path}`);
    }

    for (const [path, message] of [["reservations/999999", "Reservation not found."], ["guests/999999", "Guest not found."]]) {
        await visit(`/admin/${path}`);
        await until(`document.querySelector('#admin-content [role=alert]')?.textContent.includes(${JSON.stringify(message)})`);
        passed(`Missing record at /admin/${path} displays a useful error`);
    }

    await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await visit("/admin/reservations");
    await heading("Reservations");
    await until("Boolean(document.querySelector('.admin-table'))");
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
    passed("Mobile navigation and tables fit a 375px viewport");

    for (const role of ["guest", "owner", "null", "unknown", "anonymous"]) {
        await visit("/admin/dashboard", { role });
        await until(`location.pathname === ${JSON.stringify(role === "anonymous" ? "/login" : role === "owner" ? "/owner/dashboard" : "/")}`);
        if (role === "owner") {
            await heading("Welcome back, Owner!");
            assert.equal(await evaluate("document.querySelector('.admin-portal-label').textContent"), 'OWNER PORTAL');
        } else assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
        passed(`Admin access denied for ${role}`);
    }

    await visit("/dashboard", { role: "guest" });
    await until("document.querySelector('h1')?.textContent.startsWith('Welcome,')");
    assert.equal(await evaluate("location.pathname"), "/dashboard");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    passed("Existing guest dashboard remains separate at /dashboard");

    await visit("/make-reservation", { role: "guest" });
    await until("document.body.textContent.includes('Who is requesting the stay?')");
    assert.equal(await evaluate("location.pathname"), "/make-reservation");
    assert.equal(await evaluate("document.querySelector('fieldset select').value"), "");
    assert.equal(await evaluate("document.querySelector('fieldset select option:checked').textContent"), "Select");
    await fillEditor('input[type=tel]', '09171234567');
    await fillEditor('fieldset select', 'Phone Call');
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Continue')).click()");
    await until("document.body.textContent.includes('Tell us about your group')");
    assert.equal(await evaluate("document.querySelectorAll('input[type=number]').length"), 3);
    await fillEditor('input[aria-label="Set Number of Adults"]', '17');
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Set Number of Adults"]').value`), "17");
    passed("Guest reservation inquiry source starts at Select and guest counts accept custom numeric input");

    await visit('/dashboard', { role:'guest', accountId:2, managementMode:'unpaid' });
    await until("document.querySelector('h1')?.textContent.startsWith('Welcome,')");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='My Reservations').click()");
    await until("[...document.querySelectorAll('button')].some(button=>button.textContent.startsWith('Pay '))");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.startsWith('Pay ')).click()");
    await until("[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Reservation Deposit'))");
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Reservation Deposit')).click()");
    await until(`Boolean(document.querySelector('input[aria-label="Amount Paid"]'))`);
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Amount Paid"]').value`), "5000");
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Amount Paid"]').readOnly`), false);
    await fillEditor('input[aria-label="Amount Paid"]', '4250.75');
    assert.equal(await evaluate(`document.querySelector('input[aria-label="Amount Paid"]').value`), "4250.75");
    passed("Deposit amount defaults to 5000 and remains editable");

    await visit("/admin/dashboard", { role: "admin", sessionError: true });
    await until("Boolean(document.querySelector('[role=alert]'))");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    await evaluate("window.__adminQA.state.sessionError = false; document.querySelector('button').click()");
    await heading("Admin Dashboard");
    passed("Session errors fail closed and can be retried");

    await visit("/admin/reservations", { role: "admin", dataError: true });
    await heading("Reservations");
    await until("Boolean(document.querySelector('#admin-content [role=alert]'))");
    await evaluate("window.__adminQA.state.dataError = false; [...document.querySelectorAll('#admin-content button')].find(button=>button.textContent==='Try again').click()");
    await until("Boolean(document.querySelector('.admin-table'))");
    passed("Data errors offer retry without showing invented records");

    await visit("/admin/dashboard", { role: "admin", dataExpired: true });
    await until("location.pathname === '/login'");
    passed("Expired data requests trigger session revalidation and login redirect");

    await visit("/admin/dashboard", { role: "admin", failLogout: true });
    await heading("Admin Dashboard");
    await evaluate("document.querySelector('.admin-menu-toggle').click()");
    await until("Boolean(document.querySelector('.admin-sidebar-open'))");
    await evaluate("document.querySelector('[data-admin-signout]').click()");
    await until("Boolean(document.querySelector('.admin-sidebar [role=alert]'))");
    assert.equal(await evaluate("location.pathname"), "/admin/dashboard");
    await evaluate("window.__adminQA.state.failLogout = false; document.querySelector('[data-admin-signout]').click()");
    await until("location.pathname === '/login'");
    const logout = await evaluate("window.__adminQA.requests.findLast(request => request.path === '/auth/logout')");
    assert.equal(logout.method, "POST");
    assert.equal(logout.credentials, "include");
    assert.equal(logout.headers["X-CSRF-TOKEN"], "isolated-csrf-fixture");
    passed("Logout failures preserve session; successful logout uses existing cookie and CSRF flow");

    await navigate("/admin/dashboard");
    await until("location.pathname === '/login'");
    assert.equal(await evaluate("Boolean(document.querySelector('.admin-header'))"), false);
    passed("Protected dashboard remains inaccessible after logout");

    }
    console.log(`${checks} browser checks passed. Sessions and API data were mocked; live CAPTCHA login was not tested.`);
} finally {
    socket?.close();
    if (chrome.exitCode === null) chrome.kill();
    await delay(500);
    // Only remove the verified, unique temporary profile created by this script.
    if (resolve(profile).startsWith(resolve(tmpdir()) + "\\") || resolve(profile).startsWith(resolve(tmpdir()) + "/")) {
        try { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); }
        catch { console.warn("Temporary Chrome profile is still in use; it can be removed after Chrome exits."); }
    }
}
