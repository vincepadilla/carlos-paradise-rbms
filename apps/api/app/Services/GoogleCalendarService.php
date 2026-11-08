<?php

namespace App\Services;

use Google\Client;
use Google\Service\Calendar;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class GoogleCalendarService
{
    public function client(): Client
    {
        $settings = config('services.google_calendar');

        if (
            empty($settings['client_id']) ||
            empty($settings['client_secret']) ||
            empty($settings['redirect_uri'])
        ) {
            throw new RuntimeException(
                'Google Calendar configuration is incomplete.'
            );
        }

        $client = new Client();

        $client->setApplicationName('Carlos Paradise Reservations');
        $client->setClientId($settings['client_id']);
        $client->setClientSecret($settings['client_secret']);
        $client->setRedirectUri($settings['redirect_uri']);
        $client->setScopes([Calendar::CALENDAR_EVENTS]);
        $client->setAccessType('offline');
        $client->setPrompt('consent');

        return $client;
    }

    public function calendarId(): string
    {
        $id = (string) config('services.google_calendar.calendar_id');

        if ($id === '') {
            throw new RuntimeException('Google Calendar ID is missing.');
        }

        return $id;
    }

    public function calendar(): Calendar
    {
        $client = DB::transaction(function () {
            // Serialize token refreshes for this shared connection.
            $connection = DB::table('google_calendar_connections')
                ->where('connection_key', 'carlos_paradise')
                ->lockForUpdate()
                ->first();

            if (! $connection) {
                throw new RuntimeException(
                    'Connect your Google Calendar account first.'
                );
            }

            $tokens = json_decode(
                Crypt::decryptString($connection->encrypted_tokens),
                true,
                512,
                JSON_THROW_ON_ERROR
            );

            $client = $this->client();
            $client->setAccessToken($tokens);

            if ($client->isAccessTokenExpired()) {
                if (empty($tokens['refresh_token'])) {
                    throw new RuntimeException(
                        'Background access is missing. Reconnect Google Calendar.'
                    );
                }

                $fresh = $client->fetchAccessTokenWithRefreshToken(
                    $tokens['refresh_token']
                );

                if (
                    ! empty($fresh['error']) ||
                    empty($fresh['access_token'])
                ) {
                    throw new RuntimeException(
                        'Google access could not be renewed. Reconnect the account.'
                    );
                }

                // Google may omit the refresh token in this response.
                $fresh['refresh_token'] =
                    $fresh['refresh_token'] ?? $tokens['refresh_token'];

                $fresh['created'] = $fresh['created'] ?? time();

                $client->setAccessToken($fresh);

                DB::table('google_calendar_connections')
                    ->where('id', $connection->id)
                    ->update([
                        'encrypted_tokens' => Crypt::encryptString(
                            json_encode($fresh, JSON_THROW_ON_ERROR)
                        ),
                        'updated_at' => now(),
                    ]);
            }

            return $client;
        });

        return new Calendar($client);
    }

    public function testConnection(): array
    {
        $events = $this->calendar()->events->listEvents(
            $this->calendarId(),
            ['maxResults' => 1]
        );

        return [
            'connected' => true,
            'calendar_name' => $events->getSummary(),
        ];
    }
}