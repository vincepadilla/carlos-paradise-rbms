<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\EmailVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class SessionAuthController extends Controller
{
    public function login(Request $request, EmailVerificationService $verificationService): JsonResponse
    {
        if (is_string($request->input('email'))) {
            $request->merge([
                'email' => strtolower(trim($request->input('email'))),
            ]);
        }

        $validated = $request->validate([
            'email' => ['required', 'email', 'max:254'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
            'captcha_token' => ['required', 'string'],
        ]);

        $captchaResponse = Http::asForm()->post('https://www.google.com/recaptcha/api/siteverify', [
            'secret' => env('RECAPTCHA_SECRET_KEY'),
            'response' => $validated['captcha_token'],
            'remoteip' => $request->ip(),
        ]);

        if (! $captchaResponse->json('success')) {
            throw ValidationException::withMessages([
                'captcha_token' => ['CAPTCHA verification failed. Please try again.'],
            ]);
        }

        $credentials = [
            'email' => $validated['email'],
            'password' => $validated['password'],
            'is_active' => true,
        ];

        $guard = Auth::guard('web');
        $provider = $guard->getProvider();
        /** @var User|null $candidate */
        $candidate = $provider->retrieveByCredentials($credentials);

        if (! $candidate || ! $provider->validateCredentials($candidate, $credentials)) {
            // Same message for unknown email, wrong password or disabled account.
            throw ValidationException::withMessages([
                'email' => ['Unable to sign in with these details.'],
            ]);
        }

        if ($candidate->role?->name === 'guest' && ! $candidate->email_verified_at) {
            $guard->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json([
                'message' => 'Email verification is required.',
                'verification' => $verificationService->beginPending($request, $candidate, false),
            ], 409);
        }

        $verificationService->clearPending($request);
        $guard->login($candidate, $request->boolean('remember'));
        $request->session()->regenerate();

        /** @var User $user */
        $user = $candidate;

        return response()->json([
            'message' => 'Signed in successfully.',
            'user' => $this->userData($user),
        ]);
    }

    public function current(Request $request): JsonResponse
    {
        /** @var User|null $user */
        $user = Auth::guard('web')->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (! $user->is_active) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ($user->role?->name === 'guest' && ! $user->email_verified_at) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'Email verification is required.'], 403);
        }

        return response()->json(['user' => $this->userData($user)]);
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    private function userData(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'phone' => $user->phone,
            'avatar' => $user->avatar,
            'role' => $user->role?->name,
            'email_verified' => $user->email_verified_at !== null,
        ];
    }
}
