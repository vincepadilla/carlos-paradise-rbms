<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\EmailVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use RuntimeException;
use Throwable;

class EmailVerificationController extends Controller
{
    public function status(Request $request, EmailVerificationService $service): JsonResponse
    {
        return response()->json(['verification' => $service->pendingStatus($request)]);
    }

    public function verify(Request $request, EmailVerificationService $service): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
        ]);

        $user = $service->verifyPending($request, $validated['code']);
        $service->clearPending($request);

        try {
            $guard = Auth::guard('web');
            $guard->login($user);

            if (! $request->session()->regenerate() || (int) $guard->id() !== (int) $user->id) {
                throw new RuntimeException('The verified session could not be established.');
            }
        } catch (Throwable $exception) {
            report($exception);
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json([
                'message' => 'Your email is verified, but automatic sign-in failed. Please sign in to continue.',
                'verified' => true,
                'recovery_url' => '/login',
            ], 500);
        }

        return response()->json([
            'message' => 'Email verified and signed in successfully.',
            'verified' => true,
        ]);
    }

    public function resend(Request $request, EmailVerificationService $service): JsonResponse
    {
        return response()->json([
            'message' => 'A new verification code has been queued.',
            'verification' => $service->resendPending($request),
        ]);
    }
}
