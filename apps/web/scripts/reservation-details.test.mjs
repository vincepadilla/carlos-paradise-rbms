import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedPayments, bookingLocalTime, canAgreeTotal, priceLines, pricePreview, recordedMoney, reservationDisplayStatus, reservationDraft, totalValidation } from "../src/utils/reservationDetails.ts";

const now = Date.parse("2026-11-06T10:00:00+08:00");
const record = (overrides = {}) => ({ status: "confirmed", type: "overnight", starts_at: "2026-11-05T14:00:00+08:00", ends_at: "2026-11-07T11:00:00+08:00", ...overrides });
test("ongoing status uses confirmed stays and exclusive checkout without overriding terminal statuses", () => {
    assert.equal(reservationDisplayStatus(record(), now), "ongoing");
    for (const status of ["completed", "expired", "cancelled", "queued", "awaiting_deposit"]) assert.equal(reservationDisplayStatus(record({ status }), now), status);
    assert.equal(reservationDisplayStatus(record({ ends_at: "2026-11-06T10:00:00+08:00" }), now), "confirmed");
});
test("only active unpaid day-tour totals can be edited", () => {
    for (const status of ["pending", "queued", "awaiting_deposit"]) assert.equal(canAgreeTotal(record({ type: "day_tour", status }), now), true);
    for (const status of ["confirmed", "payment_review", "cancelled", "completed", "expired"]) assert.equal(canAgreeTotal(record({ type: "day_tour", status }), now), false);
    assert.equal(canAgreeTotal(record({ status: "pending" }), now), false);
    assert.equal(canAgreeTotal(record({ type: "day_tour", status: "pending", ends_at: "2026-11-06T10:00:00+08:00" }), now), false);
});
test("agreed total validation respects money precision, backend limits and the deposit floor", () => {
    for (const total of ["5000", "5000.01", "99999999"]) assert.equal(totalValidation(total, "5000.00"), null);
    for (const total of ["", "1e4", "-5000", "5000.001", "4999.99", "99999999.01", "Infinity", "NaN"]) assert.ok(totalValidation(total, "5000.00"));
});
test("approved payments alone count, preserving exact cents and unknown versus empty records", () => {
    assert.equal(approvedPayments(record()), null);
    assert.equal(approvedPayments(record({ payments: [] })), 0);
    assert.equal(approvedPayments(record({ payments: [{ status: "approved", amount: "0.10" }, { status: "approved", amount: "0.20" }, { status: "submitted", amount: "5000" }, { status: "rejected", amount: "5000" }] })), .3);
});
test("missing charges remain unknown; recorded zero is retained; provisional day-tour base is not an agreed rate", () => {
    assert.ok(priceLines().every(line => line.value === null));
    const details = { pricing: { base: "0.00", cleaning_fee: "0.00", optional_fee: "460.00", bonfire: null, charcoal: null } };
    assert.equal(priceLines(details)[0].value, "0.00");
    assert.equal(priceLines(details, "day_tour")[0].value, null);
    assert.equal(priceLines(details).find(line => line.label === "Optional Charges (combined)").value, "460.00");
    assert.equal(recordedMoney(null), "Not recorded");
    assert.notEqual(recordedMoney(0), "Not recorded");
});

test("editing uses booking snapshots, preserves unknown prices, and copies damage drafts without mutating server data", () => {
    const data = { reservation: { ...record(), contact_name:'Booking Guest', contact_email:'booking@example.test', contact_phone:'0917', notes:null, adults:2, children:0, pets:0 }, details: { revision:7, inquiry_source:'Phone Call', contact_address:'Booking Address', pricing:{base:'15000.00', version:2}, capabilities:{can_manage_damages:true}, damages:[{id:1, description:'Chair', item_area:'Pool', amount:'500.00', notes:null}] } };
    const draft=reservationDraft(data);
    assert.equal(draft.contact_name, 'Booking Guest'); assert.equal(draft.contact_address,'Booking Address'); assert.equal(draft.revision,7);
    assert.equal(draft.pricing.liquor,''); assert.equal(draft.checkin,'2026-11-05');
    draft.damages[0].amount='100'; assert.equal(data.details.damages[0].amount,'500.00');
    assert.equal(bookingLocalTime('2026-11-05T06:00:00Z'),'2026-11-05T14:00');
});
test("price preview discounts the base only, includes every charge, and validates incomplete or invalid inputs", () => {
    const draft={ pricing:{base:'20000', holiday_fee:'2000', extra_fee:'500', cleaning_fee:'1000', bonfire:'400', charcoal:'90', liquor:'1100', other:'50.50'}, discount:{type:'percentage',value:'10',justification:'Returning customer agreement'} };
    assert.deepEqual(pricePreview(draft),{total:23140.5,discount:2000,errors:[]});
    for (const discount of [{type:'percentage',value:'101',justification:'Reason'},{type:'fixed',value:'20001',justification:'Reason'},{type:'fixed',value:'100',justification:''}]) assert.ok(pricePreview({...draft,discount}).errors.length);
    assert.ok(pricePreview({...draft,pricing:{...draft.pricing,liquor:''}}).errors.length);
    assert.ok(pricePreview({...draft,pricing:{...draft.pricing,liquor:'-1'}}).errors.length);
});
