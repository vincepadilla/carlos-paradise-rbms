<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireOwner
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user('web');
        abort_unless($user, 401, 'Unauthenticated.');
        abort_unless($user->is_active && $user->role?->name === 'owner', 403, 'Owner access is required.');

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');
        return $response;
    }
}
