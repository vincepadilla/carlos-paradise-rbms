<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

class RegisterController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        // Store emails consistently.
        if (is_string($request->input('email'))) {
            $request->merge([
                'email' => strtolower(trim($request->input('email'))),
            ]);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:254', 'unique:users,email'],
            'phone' => ['required', 'string', 'max:30'],
            'terms' => ['accepted'],
            'password' => [
                'required',
                'string',
                'confirmed',
                Password::min(10)->letters()->numbers(),
            ],
        ]);

        $guestRole = Role::where('name', 'guest')->firstOrFail();

        $user = new User();

        $user->name = $validated['name'];
        $user->email = $validated['email'];
        $user->phone = $validated['phone'] ?? null;
        $user->password = Hash::make($validated['password']);
        $user->is_active = true;

        // The server assigns the role.
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