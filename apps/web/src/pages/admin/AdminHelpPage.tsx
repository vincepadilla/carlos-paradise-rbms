import { Link } from "react-router";
import AdminPage from "../../components/admin/AdminPage";

export default function AdminHelpPage() {
    return <AdminPage title="Help & Support">
        <p>Help and support content is not available yet.</p>
        <Link to="/" className="mt-4 inline-block text-brown underline">Visit the resort website</Link>
    </AdminPage>;
}
