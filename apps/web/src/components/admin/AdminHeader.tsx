import { useAdminSession } from '../auth/RequireAdmin';
import { Icon } from '../reservations/ReservationUI';
import { initials } from '../../utils/adminDashboard';

export default function AdminHeader({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
    const { user } = useAdminSession();
    const role = user.role === 'owner' ? 'Owner' : 'Admin';
    return <header className='admin-header'>
        <button type='button' className='admin-menu-toggle' aria-label={`${menuOpen ? 'Close' : 'Open'} ${role} menu`}
            aria-expanded={menuOpen} aria-controls='admin-sidebar' onClick={onToggleMenu}>
            <Icon name='menu' />
        </button>
        <div className='admin-welcome'>
            <b>Welcome to Carlos Paradise</b>
            <span>Manage reservations, guests, schedules, and daily operations from one place.</span>
        </div>
        <div className='admin-header-tools'>
            <span className='admin-avatar' aria-hidden='true'>{initials(user.name)}</span>
            <div className='admin-profile'><b>{user.name}</b><small>{role}</small></div>
        </div>
    </header>;
}
