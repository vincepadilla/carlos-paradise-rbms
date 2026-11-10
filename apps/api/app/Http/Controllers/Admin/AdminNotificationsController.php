<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AdminNotificationService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminNotificationsController extends Controller
{
    public function index(Request $request, AdminNotificationService $notifications): JsonResponse
    {
        $data = $request->validate(['page' => ['sometimes', 'integer', 'min:1'], 'per_page' => ['sometimes', 'integer', 'min:1', 'max:50']]);
        $notifications->syncOngoingStays();
        $page = DB::table('admin_notification_recipients as recipient')
            ->join('admin_notifications as notification', 'notification.id', '=', 'recipient.notification_id')
            ->where('recipient.user_id', $request->user()->id)
            ->orderByDesc('notification.occurred_at')->orderByDesc('notification.id')
            ->select(['notification.id', 'notification.type', 'notification.title', 'notification.description',
                'notification.reservation_id', 'notification.destination', 'notification.occurred_at', 'recipient.read_at'])
            ->paginate($data['per_page'] ?? 20);
        $page->through(fn (object $item) => [
            'id' => $item->id, 'type' => $item->type, 'title' => $item->title,
            'description' => $item->description, 'reservation_id' => $item->reservation_id,
            'destination' => $item->destination,
            'occurred_at' => CarbonImmutable::parse($item->occurred_at)->setTimezone('Asia/Manila')->toIso8601String(),
            'read_at' => $item->read_at ? CarbonImmutable::parse($item->read_at)->setTimezone('Asia/Manila')->toIso8601String() : null,
        ]);

        return response()->json($page);
    }

    public function unreadCount(Request $request, AdminNotificationService $notifications): JsonResponse
    {
        $notifications->syncOngoingStays();

        return response()->json(['unread_count' => DB::table('admin_notification_recipients')
            ->where('user_id', $request->user()->id)->whereNull('read_at')->count()]);
    }

    public function markAsRead(Request $request, int $notification): JsonResponse
    {
        $recipient = DB::table('admin_notification_recipients')->where('notification_id', $notification)
            ->where('user_id', $request->user()->id)->first();
        abort_unless($recipient, 404, 'Notification not found.');
        if (! $recipient->read_at) {
            $now = CarbonImmutable::now('Asia/Manila');
            DB::table('admin_notification_recipients')->where('id', $recipient->id)->update([
                'read_at' => $now->toIso8601String(), 'updated_at' => $now->format('Y-m-d H:i:s'),
            ]);
        }

        return response()->json(['read_at' => DB::table('admin_notification_recipients')->where('id', $recipient->id)->value('read_at')]);
    }
}
