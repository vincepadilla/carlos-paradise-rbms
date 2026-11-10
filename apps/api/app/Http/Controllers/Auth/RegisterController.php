<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class RegisterController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        if (is_string($request->input('email'))) {
            $request->merge([
                'email' => strtolower(trim($request->input('email'))),
            ]);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:254', 'unique:users,email'],
            'phone' => ['required', 'string', 'regex:/^09[0-9]{9}$/'],
            'terms' => ['accepted'],
            'captcha_token' => ['required', 'string'],
            'password' => [
                'required',
                'string',
                'confirmed',
                Password::min(10)->letters()->numbers(),
            ],
        ], [
            'phone.regex' => 'The contact number must contain exactly 11 digits and begin with 09.',
        ]);

        $captchaResponse = Http::asForm()->post('https://www.google.com/recaptcha/api/siteverify', [
            'secret' => env('RECAPTCHA_SECRET_KEY'),
            'response' => $validated['captcha_token'],
            'remoteip' => $request->ip()
        ]);

        if (!$captchaResponse->json('success')) {
            throw ValidationException::withMessages([
                'captcha_token' => ['CAPTCHA verification failed. Please try again.'],
            ]);
        }

        $guestRole = Role::where('name', 'guest')->firstOrFail();

        $user = new User();

        $user->name = $validated['name'];
        $user->email = $validated['email'];
        $user->phone = $validated['phone'] ?? null;
        $user->password = Hash::make($validated['password']);
        $user->is_active = true;

        $user->role()->associate($guestRole);

        $user->save();

        return response()->json([
            'message' => 'Account created successfully.',
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $guestRole->name,
                'email_verified' => false,
            ],
        ], 201);
    }
}
