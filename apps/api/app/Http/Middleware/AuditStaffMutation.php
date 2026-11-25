<?php

namespace App\Http\Middleware;

use App\Services\OwnerAudit;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class AuditStaffMutation
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethodSafe()) {
            return $next($request);
        }

        $request->attributes->set('audit_recorded', false);
        $route = $request->route();
        $files = [];
        $describe = function (array $uploads, string $prefix = '') use (&$describe, &$files): void {
            foreach ($uploads as $key => $file) {
                $field = $prefix.(string) $key;
                if (is_array($file)) {
                    $describe($file, $field.'.');

                    continue;
                }
                if ($file && $file->isValid()) {
                    $files[$field] = ['sha256' => hash_file('sha256', $file->getRealPath()), 'size' => $file->getSize()];
                }
            }
        };
        $describe($request->allFiles());
        $request->attributes->set('audit_context', ['method' => $request->method(), 'route' => $route->uri(),
            'targets' => array_map(fn ($value) => is_scalar($value) ? (string) $value : (string) $value->getKey(), $route->parameters()),
            'files' => $files]);

        return DB::transaction(function () use ($request, $next) {
            $response = $next($request);
            if ($response->getStatusCode() < 400 && ! $request->attributes->get('audit_recorded')) {
                $route = $request->route();
                $resource = preg_replace('#^api/(?:owner/operations|owner|admin)/#', '', $route->uri());
                $module = ucwords(str_replace('-', ' ', explode('/', $resource)[0]));
                $verb = match ($request->method()) {
                    'PATCH', 'PUT' => 'Updated', 'DELETE' => 'Deleted', default => 'Completed action for',
                };
                // Never copy request bodies, credentials, tokens, or uploaded file contents.
                app(OwnerAudit::class)->record($request->user(), 'staff_request_completed', $module, $verb.' '.strtolower($module).'.',
                    $request->attributes->get('audit_context'));
            }

            return $response;
        });
    }
}
