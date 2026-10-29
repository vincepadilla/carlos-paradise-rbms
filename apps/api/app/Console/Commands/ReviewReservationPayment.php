<?php

namespace App\Console\Commands;

use App\Http\Controllers\BookingPaymentsController;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class ReviewReservationPayment extends Command
{
    protected $signature = 'reservations:review-payment
                            {payment : Payment ID}
                            {staff_user_id : Admin or owner user ID}
                            {decision : approved or rejected}
                            {--note= : Verification or rejection reason}';

    protected $description =
        'Approve or reject a submitted reservation payment';

    public function handle(
        BookingPaymentsController $controller
    ): int {
        $staff = User::find($this->argument('staff_user_id'));

        if (! $staff) {
            $this->error('Staff user not found.');

            return self::FAILURE;
        }

        $request = Request::create(
            '/api/payments/' . $this->argument('payment') . '/review',
            'POST',
            [
                'decision' => $this->argument('decision'),
                'note' => $this->option('note'),
            ]
        );

        $request->setUserResolver(fn () => $staff);

        try {
            $controller->review(
                $request,
                (int) $this->argument('payment')
            );
        } catch (ValidationException $exception) {
            foreach ($exception->errors() as $messages) {
                foreach ($messages as $message) {
                    $this->error($message);
                }
            }

            return self::FAILURE;
        } catch (HttpExceptionInterface $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info(
            'Payment ' . $this->argument('payment') . ' ' .
            $this->argument('decision') . '.'
        );

        return self::SUCCESS;
    }
}