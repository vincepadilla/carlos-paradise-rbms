<?php

namespace App\Http\Controllers\Owner;

use App\Http\Controllers\Controller;
use App\Services\OwnerAudit;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class OwnerDocumentsController extends Controller
{
    private const KEYS = ['house-rules-policies', 'waiver-form'];

    public function index(Request $request)
    {
        $data = $request->validate(['key' => ['required', 'in:'.implode(',', self::KEYS)]]);
        $active = DB::table('active_documents')->where('document_key', $data['key'])->value('version_id');
        $versions = DB::table('document_versions as d')->leftJoin('users as u', 'u.id', '=', 'd.uploaded_by')
            ->where('document_key', $data['key'])->orderByDesc('version')
            ->get(['d.id', 'd.version', 'd.original_name', 'd.size', 'd.notes', 'd.sha256', 'd.created_at', 'u.name as uploaded_by'])
            ->map(function ($version) {
                $version->created_at = CarbonImmutable::parse($version->created_at)->setTimezone('Asia/Manila')->toIso8601String();
                return $version;
            });
        return response()->json(['active_version_id' => $active, 'versions' => $versions]);
    }

    public function store(Request $request, OwnerAudit $audit)
    {
        $data = $request->validate([
            'key' => ['required', 'in:'.implode(',', self::KEYS)],
            'file' => ['required', 'file', 'mimes:pdf', 'mimetypes:application/pdf', 'max:10240'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ]);
        $file = $request->file('file');
        abort_unless(str_starts_with(file_get_contents($file->getRealPath(), false, null, 0, 5), '%PDF-'), 422, 'A valid PDF is required.');
        $path = $file->store('owner-documents', 'local');
        abort_unless($path, 503, 'Unable to store the document.');
        try {
            DB::transaction(function () use ($data, $file, $path, $request, $audit) {
                // A stable parent lock serializes the first upload as well as later versions.
                abort_unless(DB::table('villas')->where('id', 1)->lockForUpdate()->first(), 503, 'The resort must be configured first.');
                $version = 1 + (int) DB::table('document_versions')->where('document_key', $data['key'])->max('version');
                $id = DB::table('document_versions')->insertGetId([
                    'document_key' => $data['key'], 'version' => $version,
                    'original_name' => basename($file->getClientOriginalName()), 'storage_path' => $path,
                    'sha256' => hash_file('sha256', $file->getRealPath()), 'size' => $file->getSize(),
                    'notes' => $data['notes'] ?? null, 'uploaded_by' => $request->user()->id, 'created_at' => now(),
                ]);
                DB::table('active_documents')->updateOrInsert(['document_key' => $data['key']], ['version_id' => $id, 'updated_at' => now()]);
                $audit->record($request->user(), 'document_uploaded', 'Documents', "Activated {$data['key']} version {$version} (#{$id}).",
                    ['document_id' => $id, 'document_key' => $data['key'], 'version' => $version,
                        'file_sha256' => hash_file('sha256', $file->getRealPath())]);
            });
        } catch (Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
        $request->merge(['key' => $data['key']]);
        return $this->index($request)->setStatusCode(201);
    }

    public function download(Request $request, int $document)
    {
        $version = DB::table('document_versions')->where('id', $document)->first();
        abort_unless($version, 404, 'Document version not found.');
        abort_unless(Storage::disk('local')->exists($version->storage_path), 404, 'Document file is unavailable.');
        $response = Storage::disk('local')->response($version->storage_path, 'document-v'.$version->version.'.pdf',
            ['Content-Type' => 'application/pdf', 'X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => "sandbox"],
            $request->boolean('preview') ? 'inline' : 'attachment');
        return $response;
    }
}
