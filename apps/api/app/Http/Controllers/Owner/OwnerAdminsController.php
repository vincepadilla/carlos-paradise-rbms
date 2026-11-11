<?php

namespace App\Http\Controllers\Owner;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use App\Services\OwnerAudit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class OwnerAdminsController extends Controller
{
    private const COLUMNS = ['id', 'name', 'email', 'is_active', 'created_at', 'updated_at'];

    public function index(Request $request)
    {
        $data = $request->validate(['search' => ['nullable', 'string', 'max:200']]);
        $search = trim($data['search'] ?? '');
        return User::whereHas('role', fn ($query) => $query->where('name', 'admin'))
            ->when($search !== '', fn ($query) => $query->where(fn ($q) => $q
                ->whereRaw('lower(name) like ?', ['%'.strtolower($search).'%'])
                ->orWhereRaw('lower(email) like ?', ['%'.strtolower($search).'%'])))
            ->orderBy('name')->orderBy('id')->paginate(15, self::COLUMNS);
    }

    public function store(Request $request, OwnerAudit $audit)
    {
        $data = $this->validateAccount($request);
        $user = DB::transaction(function () use ($request, $data, $audit) {
            $user = new User();
            $user->forceFill([...$data, 'role_id' => Role::where('name', 'admin')->firstOrFail()->id, 'is_active' => true]);
            $user->save();
            $audit->record($request->user(), 'admin_created', 'Admin Management', "Created admin #{$user->id} ({$user->email}).");
            return $user;
        });
        return response()->json(['admin' => $user->only(self::COLUMNS)], 201);
    }

    public function update(Request $request, int $admin, OwnerAudit $audit)
    {
        // Only role=admin records can ever be targets, including when IDs are forged.
        $user = User::whereHas('role', fn ($q) => $q->where('name', 'admin'))->findOrFail($admin);
        abort_if($user->id === $request->user()->id, 403, 'You cannot change your own account here.');
        $data = $this->validateAccount($request, $user);
        DB::transaction(function () use ($request, $user, $data, $audit) {
            $locked = User::whereHas('role', fn ($q) => $q->where('name', 'admin'))->lockForUpdate()->findOrFail($user->id);
            $locked->forceFill($data)->save();
            $audit->record($request->user(), 'admin_updated', 'Admin Management',
                "Updated admin #{$locked->id}; fields: ".implode(', ', array_keys($data)).'.');
        });
        return response()->json(['admin' => $user->refresh()->only(self::COLUMNS)]);
    }

    private function validateAccount(Request $request, ?User $user = null): array
    {
        if (is_string($request->input('email'))) $request->merge(['email' => strtolower(trim($request->input('email')))]);
        $data = $request->validate([
            'name' => [$user ? 'sometimes' : 'required', 'string', 'max:255'],
            'email' => [$user ? 'sometimes' : 'required', 'email', 'max:254', Rule::unique('users')->ignore($user?->id)],
            'password' => [$user ? 'nullable' : 'required', 'string', Password::min(12)->letters()->mixedCase()->numbers(), 'max:128'],
            'is_active' => ['sometimes', 'boolean'], 'role_id' => ['prohibited'], 'role' => ['prohibited'],
        ]);
        if (empty($data['password'])) unset($data['password']);
        return $data;
    }
}
