<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminGuestsController extends Controller
{
    private function guests(): Builder
    {
        return User::query()
            ->whereHas('role', fn (Builder $query) => $query->where('name', 'guest'))
            ->select(['id', 'name', 'email', 'phone', 'is_active', 'email_verified_at']);
    }

    public function index(Request $request): JsonResponse
    {
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);

        return response()->json($this->guests()->orderBy('id')->paginate(25));
    }

    public function show(int $guest): JsonResponse
    {
        return response()->json(['guest' => $this->guests()->findOrFail($guest)]);
    }
}
