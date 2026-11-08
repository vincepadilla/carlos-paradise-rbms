import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, blockDescription, blockReason, calendarDays, calendarEvents, calendarTitle, eventHref, eventsOnDate, manilaDate, moveCalendar } from "../src/utils/adminCalendar.ts";

const record = overrides => ({ id: 1, status: "confirmed", contact_name: "Test Guest", starts_at: "2026-11-05T14:00:00+08:00", ends_at: "2026-11-07T11:00:00+08:00", ...overrides });
const now = Date.parse("2026-11-06T10:00:00+08:00");

test("Month uses 42 Sunday-first cells, including overflow days and leap day", () => {
    const days = calendarDays("2024-02-12", "Month");
    assert.equal(days.length, 42);
    assert.equal(days[0], "2024-01-28");
    assert.equal(days.at(-1), "2024-03-09");
    assert.ok(days.includes("2024-02-29"));
    assert.equal(calendarDays("2026-11-06", "Month")[0], "2026-11-01");
});
test("Week, Day and navigation handle month/year boundaries", () => {
    assert.deepEqual(calendarDays("2026-12-31", "Week"), ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    assert.deepEqual(calendarDays("2026-12-31", "Day"), ["2026-12-31"]);
    assert.equal(moveCalendar("2026-12-31", "Month", 1), "2027-01-01");
    assert.equal(moveCalendar("2026-01-31", "Month", 1), "2026-02-01");
    assert.equal(moveCalendar("2026-12-31", "Week", 1), "2027-01-07");
    assert.equal(moveCalendar("2026-12-31", "Day", 1), "2027-01-01");
    assert.equal(calendarTitle("2026-11-06", "Month"), "November 2026");
});
test("Today follows Manila rather than the browser/system timezone", () => {
    assert.equal(manilaDate(Date.parse("2026-11-06T23:30:00Z")), "2026-11-07");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});
test("Secured, completed, deposit, queue and review states remain distinct", () => {
    const records = ["confirmed", "reserved", "completed", "awaiting_deposit", "queued", "payment_review", "pending", "cancelled", "expired"]
        .map((status, index) => record({ id: index + 1, status }));
    const events = calendarEvents({ reservations: records, blocks: [] }, now);
    assert.deepEqual(events.map(event => event.category), ["secured", "secured", "completed", "opportunity", "queue", "opportunity", "queue"]);
    assert.equal(events[0].label, "Ongoing Stay");
    assert.equal(events[3].label, "Awaiting Deposit");
    assert.equal(events[5].label, "Payment Review");
    assert.equal(eventHref(events[4]), "/admin/queue");
    assert.equal(eventHref(events[3]), "/admin/reservations/4");
});
test("Historical confirmed stays use the historical style; future confirmed stays remain secured", () => {
    assert.equal(calendarEvents({ reservations: [record({})], blocks: [] }, Date.parse("2026-11-08T00:00:00+08:00"))[0].category, "completed");
    assert.equal(calendarEvents({ reservations: [record({})], blocks: [] }, Date.parse("2026-11-01T00:00:00+08:00"))[0].label, "Secured Reservation");
});
test("Multi-day stays include checkout day when occupied, and exclude an exact-midnight checkout", () => {
    const event = calendarEvents({ reservations: [record({})], blocks: [] }, now);
    assert.equal(eventsOnDate(event, "2026-11-05").length, 1);
    assert.equal(eventsOnDate(event, "2026-11-07").length, 1);
    assert.equal(eventsOnDate(event, "2026-11-08").length, 0);
    const midnight = calendarEvents({ reservations: [record({ ends_at: "2026-11-07T00:00:00+08:00" })], blocks: [] }, now);
    assert.equal(eventsOnDate(midnight, "2026-11-07").length, 0);
});
test("Blocked ranges use exclusive ends and do not hide internal requests", () => {
    const events = calendarEvents({ reservations: [record({ status: "queued" })], blocks: [{ id: 1, starts_on: "2026-11-05", ends_on: "2026-11-07", reason: "Maintenance" }] }, now);
    assert.equal(eventsOnDate(events, "2026-11-05").length, 2);
    assert.equal(eventsOnDate(events, "2026-11-07").filter(event => event.kind === "block").length, 0);
});
test("Empty or invalid records do not create prototype events", () => {
    assert.deepEqual(calendarEvents({ reservations: [], blocks: [] }), []);
    assert.deepEqual(calendarEvents({ reservations: [record({ starts_at: "invalid" })], blocks: [] }), []);
});
test('Ocular visits become single-day calendar events', () => {
    const events = calendarEvents({ reservations: [], blocks: [], ocular_visits: [{
        id: 8, guest_name: 'Maria Santos', contact_details: '09171234567', visit_date: '2026-11-20',
        start_time: '10:00:00', end_time: '11:30:00', status: 'approved', inquiry_source: null, notes: null, created_by: 1,
    }] });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'ocular');
    assert.equal(events[0].ocularVisit.id, 8);
    assert.equal(events[0].id, 'ocular-8');
    assert.equal(events[0].category, 'ocular');
    assert.equal(events[0].label, 'Approved');
    assert.equal(events[0].startsOn, '2026-11-20');
    assert.equal(events[0].endsOn, '2026-11-21');
});

test("Optional notes round-trip through the existing reason field", () => {
    const text = blockReason(" Maintenance ", " Staff access only\nBring keys ");
    assert.deepEqual(blockDescription(text), { reason: "Maintenance", notes: "Staff access only\nBring keys" });
    assert.deepEqual(blockDescription("Legacy reason"), { reason: "Legacy reason", notes: "" });
});
