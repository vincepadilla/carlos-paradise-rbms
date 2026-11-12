<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireVerifiedGuestEmail
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user('web');
        abort_unless($user, 401, 'Unauthenticated.');

        if ($user->role?->name === 'guest' && ! $user->email_verified_at) {
            abort(403, 'Email verification is required.');
        }

        return $next($request);
    }
}
