<?php

namespace App\Http\Controllers\Owner;

use App\Http\Controllers\Controller;
use App\Services\ApplicationBackup;
use App\Services\OwnerAudit;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class OwnerDatabaseController extends Controller
{
    public function download(Request $request, ApplicationBackup $backup, OwnerAudit $audit)
    {
        $snapshot = $backup->snapshot();
        $audit->record($request->user(), 'backup_downloaded', 'Database', 'Generated application data export (credentials and files excluded).');
        return response()->streamDownload(function () use ($snapshot) {
            echo json_encode($snapshot, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }, 'carlos-paradise-'.now('Asia/Manila')->format('Y-m-d-His').'.json',
            ['Content-Type' => 'application/json', 'Cache-Control' => 'no-store, private']);
    }

    public function validateBackup(Request $request)
    {
        $request->validate(['file' => ['required', 'file', 'max:20480']]);
        $data = json_decode(file_get_contents($request->file('file')->getRealPath()), true, 64);
        if (!is_array($data) || ($data['format'] ?? null) !== 'carlos-paradise-application-export'
            || ($data['version'] ?? null) !== 1 || !is_array($data['tables'] ?? null) || $data['tables'] === []) {
            throw ValidationException::withMessages(['file' => 'Choose a valid Carlos Paradise version 1 application export.']);
        }
        $counts = [];
        foreach ($data['tables'] as $table => $rows) {
            if (!in_array($table, ApplicationBackup::TABLES, true) || !is_array($rows) || !array_is_list($rows)
                || array_filter($rows, fn ($row) => !is_array($row) || array_is_list($row))) {
                throw ValidationException::withMessages(['file' => 'The export contains an unsupported table or invalid records.']);
            }
            $counts[$table] = count($rows);
        }
        return response()->json(['tables' => $counts, 'restore_supported' => false,
            'message' => 'Export format recognized. Automatic restore is unavailable because credentials and private files are excluded. No records were changed.']);
    }
}
