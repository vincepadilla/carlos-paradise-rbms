<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireAdminOrOwner
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user('web');

        abort_unless($user, 401, 'Unauthenticated.');
        abort_unless(
            $user->is_active && in_array($user->role?->name, ['admin', 'owner'], true),
            403,
            'Admin or owner access is required.',
        );

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }
}
