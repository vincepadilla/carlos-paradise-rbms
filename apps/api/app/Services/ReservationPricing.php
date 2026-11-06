<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

class ReservationPricing
{
    public const CHARGES = ['base', 'holiday_fee', 'extra_fee', 'cleaning_fee', 'bonfire', 'charcoal', 'liquor', 'other'];

    public static function cents(string|int|float $value): int
    {
        return (int) round((float) $value * 100);
    }

    public static function money(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    public static function balance(int $reservation, int $damages, int $paid, bool $agreed): array
    {
        return ['damage_total' => self::money($damages), 'paid' => self::money($paid),
            'amount_due' => $agreed ? self::money(max(0, $reservation + $damages - $paid)) : null,
            'credit_balance' => $agreed ? self::money(max(0, $paid - $reservation - $damages)) : null];
    }

    public function calculate(array $charges, array $discount, string $deposit): array
    {
        $cents = array_map(fn ($value) => self::cents($value), $charges);
        $base = $cents['base'];
        $value = self::cents($discount['value']);
        if ($discount['type'] === 'percentage' && $value > 10000) {
            throw ValidationException::withMessages(['discount.value' => 'Percentage discounts cannot exceed 100%.']);
        }
        if ($discount['type'] === 'fixed' && $value > $base) {
            throw ValidationException::withMessages(['discount.value' => 'A fixed discount cannot exceed the base reservation price.']);
        }
        $amount = match ($discount['type']) {
            'percentage' => intdiv($base * $value + 5000, 10000), 'fixed' => $value, default => 0,
        };
        $total = array_sum($cents) - $amount;
        if ($total < self::cents($deposit) || $total > 9999999900) {
            throw ValidationException::withMessages(['pricing' => 'The final price must cover the required deposit and cannot exceed PHP 99,999,999.']);
        }

        return [
            ...array_map(fn ($value) => self::money($value), $cents),
            'version' => 2, 'optional_fee' => self::money($cents['bonfire'] + $cents['charcoal']),
            'total' => self::money($total), 'deposit' => $deposit,
            'discount' => [
                'type' => $discount['type'], 'value' => $discount['type'] === 'none' ? '0.00' : self::money($value),
                'amount' => self::money($amount), 'justification' => $discount['type'] === 'none' ? null : trim($discount['justification']),
            ],
        ];
    }
}
