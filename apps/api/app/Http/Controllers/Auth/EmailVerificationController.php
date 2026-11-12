<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\EmailVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller
{
    public function status(Request $request, EmailVerificationService $service): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'max:100']]);
        return response()->json(['verification' => $service->status($validated['token'])]);
    }

    public function verify(Request $request, EmailVerificationService $service): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'max:100'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
        ]);
        $service->verify($validated['token'], $validated['code']);
        return response()->json(['message' => 'Email verified successfully.']);
    }

    public function resend(Request $request, EmailVerificationService $service): JsonResponse
    {
        $validated = $request->validate(['token' => ['required', 'string', 'max:100']]);
        return response()->json([
            'message' => 'A new verification code has been queued.',
            'verification' => $service->resend($validated['token']),
        ]);
    }
}
