<?php

namespace App\Http\Controllers;

use App\Services\ReservationWorkflow;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class GuestProfileController extends Controller
{
    public function __construct(private ReservationWorkflow $flow)
    {
    }

    public function show(Request $request)
    {
        $user = $request->user()?->fresh();
        $this->flow->active($user);

        return response()->json(['user' => $this->present($user)]);
    }

    public function update(Request $request)
    {
        $this->flow->active($request->user());

        $request->merge([
            'name' => is_string($request->input('name'))
                ? trim($request->input('name')) : $request->input('name'),
            'contact' => is_string($request->input('contact'))
                ? trim($request->input('contact')) : $request->input('contact'),
        ]);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'contact' => ['required', 'string', 'min:7', 'max:30'],
        ]);

        return DB::transaction(function () use ($request, $data) {
            $user = $request->user()->newQuery()
                ->whereKey($request->user()->getKey())
                ->lockForUpdate()
                ->first();

            $this->flow->active($user);
            $column = $this->contactColumn();

            // Only these two fields can be changed through this endpoint.
            // Ignore client-supplied IDs, roles, email and account status.
            $user->setAttribute('name', $data['name']);
            $user->setAttribute($column, $data['contact']);
            $user->save();

            return response()->json([
                'message' => 'Profile updated successfully.',
                'user' => $this->present($user->fresh()),
            ]);
        });
    }

    private function contactColumn(): string
    {
        // Support the account field names used across the supplied versions.
        foreach (['contact', 'phone', 'contact_phone'] as $column) {
            if (Schema::hasColumn('users', $column)) {
                return $column;
            }
        }

        abort(503, 'The users contact field has not been configured.');
    }

    private function present($user): array
    {
        $column = $this->contactColumn();
        $attributes = $user->getAttributes();
        $role = DB::table('roles')
            ->where('id', $user->role_id)
            ->value('name');

        abort_unless(
            in_array(strtolower((string) $role), ['guest', 'admin', 'owner'], true),
            403,
            'This account role is not configured.'
        );

        // Return only the public account fields required by the frontend.
        return [
            'id' => $user->getKey(),
            'name' => $user->name,
            'email' => $user->email,
            'contact' => $user->getAttribute($column),
            'role' => strtolower((string) $role),
            'active' => (bool) ($attributes['is_active'] ?? $attributes['active'] ?? true),
        ];
    }
}
