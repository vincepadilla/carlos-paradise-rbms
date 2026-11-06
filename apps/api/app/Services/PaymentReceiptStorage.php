<?php

namespace App\Services;

class PaymentReceiptStorage
{
    public const PREVIEW_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

    public function __construct(private ReservationWorkflow $flow) {}

    public function describe(object $payment): array
    {
        $path = $payment->receipt_storage_path;
        $exists = $path && $this->flow->disk()->exists($path);

        return [
            'available' => (bool) $exists,
            'mime' => $exists ? $this->flow->disk()->mimeType($path) : null,
        ];
    }

    public function serve(object $payment, bool $preview = false)
    {
        $receipt = $this->describe($payment);
        abort_unless($receipt['available'], 404, 'Receipt file not found.');
        $supported = in_array($receipt['mime'], self::PREVIEW_TYPES, true);
        abort_if($preview && ! $supported, 415, 'This receipt format cannot be previewed safely.');
        $extension = match ($receipt['mime']) {
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'application/pdf' => 'pdf', default => 'bin',
        };

        return $this->flow->disk()->response($payment->receipt_storage_path, 'receipt-'.$payment->id.'.'.$extension, [
            'Content-Type' => $supported ? $receipt['mime'] : 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'no-store, private',
            'Content-Security-Policy' => "default-src 'none'; sandbox; frame-ancestors 'none'",
        ], $preview ? 'inline' : 'attachment');
    }
}
