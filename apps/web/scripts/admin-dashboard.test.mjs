import assert from "node:assert/strict";
import { test } from "node:test";
import { depositState, initials, selectDashboard, stayDuration } from "../src/utils/adminDashboard.ts";

const now = Date.parse("2026-11-06T10:00:00+08:00");
const reservation = (overrides = {}) => ({
    id: 1, reference: "TEST-1", status: "confirmed", type: "overnight", adults: 18, children: 2,
    starts_at: "2026-11-05T14:00:00+08:00", ends_at: "2026-11-07T11:00:00+08:00",
    deposit: "5000.00", payments: [], ...overrides,
});

test("occupancy only uses confirmed stays, with exclusive check-out boundaries", () => {
    const unpaid = reservation({ id: 2, status: "awaiting_deposit", queue_position: 1 });
    const ended = reservation({ id: 3, ends_at: "2026-11-06T10:00:00+08:00" });
    const actual = reservation({ id: 4 });
    const result = selectDashboard([unpaid, ended, actual], now);
    assert.equal(result.ongoing.id, 4);
    assert.equal(result.movement.reservation.id, 4);
    assert.equal(result.movement.kind, "Check-out");
    assert.equal(selectDashboard([unpaid, ended], now).ongoing, null);
});

test("queue uses server positions and does not mutate API records", () => {
    const later = reservation({ id: 6, status: "queued", queue_position: 8 });
    const first = reservation({ id: 8, status: "awaiting_deposit", queue_position: 3 });
    const input = [later, first];
    assert.deepEqual(selectDashboard(input, now).queue.map(item => item.queue_position), [3, 8]);
    assert.deepEqual(input.map(item => item.id), [6, 8]);
});

test("deposit review counts reviewable submissions, excluding approved and rejected payments", () => {
    const record = reservation({ status: "payment_review", payments: [
        { id: 1, amount: "5000.00", status: "approved" },
        { id: 2, amount: "2000.00", status: "submitted" },
        { id: 3, amount: "5000.00", status: "rejected" },
        { id: 4, amount: "3000.00", status: "submitted" },
    ] });
    assert.deepEqual(selectDashboard([record], now).deposits.map(item => item.payment.id), [4, 2]);
    assert.deepEqual(depositState(record), { label: "Verified", amount: 5000 });
    assert.deepEqual(depositState(reservation({ payments: [{ amount: "2000.00", status: "approved" }] })), { label: "Partially verified", amount: 2000 });
    assert.deepEqual(depositState(reservation({ payments: [{ amount: "5000.00", status: "submitted" }] })), { label: "Awaiting review" });
});

test("next movement excludes tentative bookings and resolves same-time turnover to checkout first", () => {
    const next = reservation({ id: 2, starts_at: "2026-11-07T11:00:00+08:00", ends_at: "2026-11-08T11:00:00+08:00" });
    const tentative = reservation({ id: 3, status: "payment_review", starts_at: "2026-11-06T11:00:00+08:00" });
    assert.equal(selectDashboard([next, reservation(), tentative], now).movement.kind, "Check-out");
    assert.equal(selectDashboard([next], now).movement.kind, "Check-in");
});

test("Manila calendar dates determine duration, including across a UTC date boundary", () => {
    assert.equal(stayDuration(reservation()), "3 days and 2 nights");
    assert.equal(stayDuration(reservation({ starts_at: "2026-11-05T16:30:00Z", ends_at: "2026-11-07T03:00:00Z" })), "2 days and 1 night");
    assert.equal(stayDuration(reservation({ type: "day_tour" })), "Day tour");
});

test("empty or malformed schedules never create a fictional stay or movement", () => {
    const result = selectDashboard([], now);
    assert.equal(result.ongoing, null);
    assert.equal(result.movement, null);
    assert.deepEqual(result.queue, []);
    assert.deepEqual(result.deposits, []);
    assert.equal(selectDashboard([reservation({ starts_at: "invalid" })], now).ongoing, null);
    assert.equal(selectDashboard([reservation({ payments: undefined })], now).paymentsAvailable, false);
});

test("initials use the authenticated name and handle whitespace and Unicode", () => {
    assert.equal(initials("  Juan   Dela Cruz "), "JD");
    assert.equal(initials("Élodie Santos"), "ÉS");
    assert.equal(initials(""), "A");
});
