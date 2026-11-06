import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingDeposits, paymentDifference, paymentReviewLabel, rejectionValidation } from "../src/utils/paymentReview.ts";

test("amount comparison uses cents and treats invalid amounts as unavailable", () => {
    assert.equal(paymentDifference('5000.00', '5000'), 0);
    assert.equal(paymentDifference('5000.00', '4999.99'), -.01);
    assert.equal(paymentDifference('5000.00', '5000.01'), .01);
    for (const value of ['', 'NaN', '0', '-50', 'Infinity']) assert.equal(paymentDifference('5000', value), null);
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
