<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

final class ReservationIntervalNormalizer
{
    private const CLEANING_MINUTES = 120;

    public static function queueCalendarEnd(CarbonImmutable $checkout, string $type): CarbonImmutable
    {
        return $type === 'overnight' ? $checkout->addMinutes(self::CLEANING_MINUTES) : $checkout;
    }

    /** @return array{start: int, end: int} */
    public function interval(
        string $start,
        string $end,
        ReservationIntervalMode $mode,
        ?string $type = null,
        bool $requiresCleaning = false,
    ): array {
        $startEpoch = $this->epoch($start);
        $endEpoch = $this->epoch($end);

        // Validate raw boundaries before cleaning could hide an invalid stay.
        if ($startEpoch >= $endEpoch) {
            throw new InvalidArgumentException('Interval start must be strictly before end.');
        }

        return ['start' => $startEpoch, 'end' => $this->effectiveEnd($endEpoch, $mode, $type, $requiresCleaning)];
    }

    public function effectiveEnd(int $rawEnd, ReservationIntervalMode $mode, ?string $type, bool $requiresCleaning): int
    {
        if ($mode !== ReservationIntervalMode::Current && $type === 'overnight' && $requiresCleaning) {
            return $rawEnd + self::CLEANING_MINUTES * 60;
        }

        return $rawEnd;
    }

    public function epoch(string $value): int
    {
        // Accept absolute DB/ISO values only; never relative dates or PHP's default timezone.
        if (! preg_match('/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/D', $value)) {
            throw new InvalidArgumentException('Expected an absolute date or timestamp.');
        }

        try {
            $instant = new DateTimeImmutable($value, new DateTimeZone('Asia/Manila'));
        } catch (\Exception $exception) {
            throw new InvalidArgumentException('Invalid interval timestamp.', previous: $exception);
        }

        $errors = DateTimeImmutable::getLastErrors();
        if ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) {
            throw new InvalidArgumentException('Invalid interval timestamp.');
        }
        if ($instant->format('u') !== '000000') {
            throw new InvalidArgumentException('The interval tree requires whole-second timestamps.');
        }

        return $instant->setTimezone(new DateTimeZone('Asia/Manila'))->getTimestamp();
    }
}
