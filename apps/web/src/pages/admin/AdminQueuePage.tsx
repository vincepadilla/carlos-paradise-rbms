import { StaffNavigate as Navigate } from "../../components/admin/StaffRouting";


export default function AdminQueuePage() {
    return <Navigate to='/admin/reservations?tab=queue-management' replace />;
}
