# Eligibility-constrained FIFO

In **Reservations → Queue Management**, an Admin or Owner opens the reservation holding the dates. They can extend an expired payment window or release the hold. Releasing it records the opportunity, staff member, decision time and original stay dates. The system then recommends one guest or reports that nobody qualifies. Staff review and approve the deposit opportunity in a separate action.

## Selection rules

1. Consider pending or queued requests that existed when staff released the hold. Check-in may equal the decision time. Checkout must follow check-in.
2. Match the guest's original stay against the released stay. Touching endpoints do not overlap.
3. Use the interval tree for the remaining confirmed stays, protected unpaid opportunities, payments under review, administrative blocks and approved ocular visits. For this queue decision, both stored and proposed overnight stays occupy the villa for 120 minutes after checkout. Day tours use the original checkout.
4. Choose the earliest original request time, then the lowest reservation ID. A later approval rechecks the calendar, the waiting guest and whether a payable deposit window remains. Repeating a successful grant for the same release and guest returns the existing reservation.

## Staff API

| Method and path | Behavior |
| --- | --- |
| `POST /api/reservations/{id}/opportunity/release` | Release an unpaid hold and return the initial recommendation. |
| `POST /api/v1/algorithm/solve` | Send `{"operation":"queue_select","release_id":123}` to recompute the recommendation. The response includes the candidate ID or null, eligible count, reason, elapsed milliseconds and whether approval is required. |
| `POST /api/reservations/{candidate}/opportunity` | Send `{"release_id":123}` to approve the current candidate under the villa transaction lock. |
| `POST /api/reservations/{id}/opportunity/extend` | Send a later `deadline` in Manila local time (`YYYY-MM-DDTHH:mm`) to extend an unreleased unpaid hold before check-in. |

## Reproduce the benchmark

From `apps/api`, run `php tests/Benchmarks/reservation-queue.php --assert-performance`. The benchmark exercises the PHP selector on queues of 32, 128, 512 and 2,048 requests at 30%, 60% and 90% calendar load, with 30 seeds and 24 release decisions per dataset. An independent scan and sort checks both the selected ID and the count of eligible guests. The timed batch includes building the remaining protected trees and evaluating eligibility. Database access and HTTP latency are outside this measurement.

The saved Colab run found eligible guests in 4,650 of 8,640 releases. The PHP run on Windows with PHP 8.2.12 used a different random-number generator and found eligible guests in 4,469 of 8,640 releases. Both recorded 100% FIFO compliance on their nonempty cases. The PHP run had zero candidate or count mismatches and averaged 54.03 ms per batch of 24 releases at 2,048 requests and 60% load. The PBL target is 100 ms for that batch.
