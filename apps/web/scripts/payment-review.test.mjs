import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingDeposits, paymentCents, paymentReviewLabel, rejectionValidation } from "../src/utils/paymentReview.ts";

test("payment amounts use exact cents and treat invalid amounts as unavailable", () => {
    assert.equal(paymentCents('5000.00'), 500000);
    assert.equal(paymentCents('4999.99'), 499999);
    assert.equal(paymentCents('5000.01'), 500001);
    for (const value of ['', 'NaN', '0', '-50', 'Infinity']) assert.equal(paymentCents(value), null);
});
test("only submitted payments on a reservation under review enter the pending list", () => {
    const record = status => ({ id: 1, status, payments: [{ id: 1, status: 'approved' }, { id: 2, status: 'rejected' }, { id: 3, status: 'submitted' }] });
    assert.deepEqual(pendingDeposits([record('payment_review')]).map(p => p.payment.id), [3]);
    for (const status of ['confirmed', 'cancelled', 'expired', 'awaiting_deposit', 'completed']) assert.deepEqual(pendingDeposits([record(status)]), []);
    assert.equal(paymentReviewLabel('approved'), 'Verified');
    assert.equal(paymentReviewLabel('submitted'), 'Awaiting Review');
});
test("rejection reasons require meaningful bounded text", () => {
    for (const value of ['', '   ', 'ab', 'x'.repeat(1001)]) assert.ok(rejectionValidation(value));
    assert.equal(rejectionValidation('  Unreadable receipt  '), null);
});
