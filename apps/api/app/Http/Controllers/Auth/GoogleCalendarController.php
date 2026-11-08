<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\GoogleCalendarService;
use Google\Service\Calendar;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class GoogleCalendarController extends Controller
{
    public function redirect(
        Request $request,
        GoogleCalendarService $service
    ) {
        $user = $this->authorizedUser($request);

        $state = Str::random(64);

        $request->session()->put('google_calendar_oauth', [
            'state' => $state,
            'user_id' => (string) $user->getAuthIdentifier(),
            'expires_at' => now()->addMinutes(10)->timestamp,
        ]);

        $client = $service->client();
        $client->setState($state);
        $client->setPrompt('consent select_account');

        return redirect()->away($client->createAuthUrl());
    }

    public function callback(
        Request $request,
        GoogleCalendarService $service
    ) {
        $user = $this->authorizedUser($request);

        // Consume the state so the callback cannot be replayed.
        $pending = $request->session()->pull('google_calendar_oauth');
        $state = $request->query('state');

        abort_unless(
            is_array($pending)
            && is_string($state)
            && is_string($pending['state'] ?? null)
            && hash_equals($pending['state'], $state)
            && ($pending['user_id'] ?? null)
                === (string) $user->getAuthIdentifier()
            && ($pending['expires_at'] ?? 0) > now()->timestamp,
            403,
            'Calendar connection expired. Please start again.'
        );

        if ($request->has('error')) {
            return response()->json([
                'message' => 'Google Calendar connection was not authorized.',
            ], 400);
        }

        $code = $request->query('code');

        abort_unless(
            is_string($code) && $code !== '',
            400,
            'Missing Google authorization code.'
        );

        try {
            $client = $service->client();
            $tokens = $client->fetchAccessTokenWithAuthCode($code);

            if (
                ! empty($tokens['error'])
                || empty($tokens['access_token'])
            ) {
                return response()->json([
                    'message' => 'Google authorization failed. Please reconnect.',
                ], 400);
            }

            $grantedScopes = preg_split(
                '/\s+/',
                trim((string) ($tokens['scope'] ?? '')),
                -1,
                PREG_SPLIT_NO_EMPTY
            );

            if (! in_array(Calendar::CALENDAR_EVENTS, $grantedScopes, true)) {
                return response()->json([
                    'message' => 'Calendar event access is required. '
                        . 'Reconnect and allow that permission.',
                ], 400);
            }

            // Require a fresh token instead of mixing credentials
            // from potentially different Google accounts.
            if (empty($tokens['refresh_token'])) {
                return response()->json([
                    'message' => 'Google did not provide background access. '
                        . 'Please reconnect and approve consent again.',
                ], 400);
            }

            $tokens['created'] = $tokens['created'] ?? time();

            DB::table('google_calendar_connections')->upsert(
                [[
                    'connection_key' => 'carlos_paradise',
                    'connected_by' => (string) $user->getAuthIdentifier(),
                    'encrypted_tokens' => Crypt::encryptString(
                        json_encode($tokens, JSON_THROW_ON_ERROR)
                    ),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]],
                ['connection_key'],
                ['connected_by', 'encrypted_tokens', 'updated_at']
            );

            return response()->json([
                'message' => 'Google Calendar account connected successfully.',
                'next_step' => 'Configure the shared calendar ID.',
            ])->header('Cache-Control', 'no-store');
        } catch (Throwable $exception) {
            // Avoid logging OAuth codes, tokens, or response bodies.
            Log::warning('Google Calendar connection failed.', [
                'exception_type' => get_class($exception),
            ]);

            return response()->json([
                'message' => 'Unable to connect Google Calendar. Please try again.',
            ], 500);
        }
    }

    private function authorizedUser(Request $request)
    {
        $user = $request->user('web');

        abort_unless($user, 401, 'Please sign in first.');

        abort_unless(
            $user->is_active
            && in_array(
                strtolower((string) $user->role?->name),
                ['admin', 'owner'],
                true
            ),
            403,
            'Only Admin and Owner can connect Google Calendar.'
        );

        return $user;
    }
}