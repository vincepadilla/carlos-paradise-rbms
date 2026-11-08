import { Navigate } from 'react-router';

export default function AdminQueuePage() {
    return <Navigate to='/admin/reservations?tab=queue-management' replace />;
}
