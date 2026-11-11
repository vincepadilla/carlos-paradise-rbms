<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\InvalidStateException;
use Throwable;

class GoogleAuthController extends Controller
{
    public function redirect(Request $request): RedirectResponse
    {
        $page = $request->query('from') === 'register' ? 'register' : 'login';
        $request->session()->put('google_auth_page', $page);
        $request->session()->put(
            'google_signup_terms',
            $page === 'register' && $request->boolean('terms')
        );

        try {
            // Keep normal session state validation; do not use stateless().
            return Socialite::driver('google')
                ->scopes(['openid', 'profile', 'email'])
                ->with(['prompt' => 'select_account'])
                ->redirect();
        } catch (Throwable $exception) {
            report($exception);
            return $this->failure($page, 'unavailable');
        }
    }

    public function callback(Request $request): RedirectResponse
    {
        $page = $request->session()->pull('google_auth_page', 'login');
        $page = $page === 'register' ? 'register' : 'login';
        $termsAccepted = $request->session()->pull('google_signup_terms', false);

        if ($request->has('error')) {
            $request->session()->forget('state');
            return $this->failure($page, 'cancelled');
        }

        try {
            // Socialite validates OAuth state and retrieves Google userinfo.
            $google = Socialite::driver('google')->user();
            $googleId = (string) $google->getId();
            $email = strtolower(trim((string) $google->getEmail()));
            $raw = $google->getRaw();
            $emailVerified = filter_var(
                $raw['email_verified'] ?? $raw['verified_email'] ?? false,
                FILTER_VALIDATE_BOOLEAN
            );

            if ($googleId === '' || strlen($googleId) > 255 ||
                ! filter_var($email, FILTER_VALIDATE_EMAIL) ||
                strlen($email) > 254 || ! $emailVerified) {
                return $this->failure($page, 'unverified');
            }

            // Google's stable account ID identifies returning Google users.
            $user = User::where('google_id', $googleId)->first();

            if (! $user) {
                // Never silently attach Google to an existing password account.
                if (User::whereRaw('lower(email) = ?', [$email])->exists()) {
                    return $this->failure($page, 'existing_account');
                }

                // Login never creates a new Google account or redirects to signup.
                if ($page === 'login') {
                    return $this->failure('login', 'not_registered');
                }

                // A first-time user must start on signup and agree to the terms.
                if (! $termsAccepted) {
                    return $this->failure('register', 'signup_required');
                }

                $guestRole = Role::where('name', 'guest')->firstOrFail();
                $user = new User();
                $user->name = Str::limit($google->getName() ?: 'Guest', 255, '');
                $user->email = $email;
                $user->google_id = $googleId;
                $user->avatar = $google->getAvatar();
                $user->password = null;
                $user->email_verified_at = now();
                $user->is_active = true;
                $user->role()->associate($guestRole);

                try {
                    $user->save();
                } catch (QueryException $exception) {
                    // Handle simultaneous callbacks without creating duplicates.
                    if ($exception->getCode() !== '23505') throw $exception;
                    $user = User::where('google_id', $googleId)->first();
                    if (! $user) return $this->failure($page, 'existing_account');
                }
            }

            if (! $user->is_active) {
                return $this->failure($page, 'unavailable_account');
            }

            Auth::guard('web')->login($user);
            $request->session()->regenerate();

            // Tokens and passwords are never placed in the URL or browser storage.
            return redirect()->away($this->frontend(match ($user->role?->name) {
                'owner' => '/owner/dashboard', 'admin' => '/admin/dashboard', default => '/',
            }));
        } catch (InvalidStateException $exception) {
            return $this->failure($page, 'expired');
        } catch (Throwable $exception) {
            report($exception);
            return $this->failure($page, 'unavailable');
        }
    }

    private function failure(string $page, string $code): RedirectResponse
    {
        $path = $page === 'register' ? '/register' : '/login';
        return redirect()->away(
            $this->frontend($path) . '?google_error=' . rawurlencode($code)
        );
    }

    private function frontend(string $path): string
    {
        return rtrim(
            (string) config('services.google.frontend_url', 'http://localhost:5173'),
            '/'
        ) . $path;
    }
}
