import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { toast } from 'sonner';
import {
    LayoutDashboard, Users, Scissors, Package, Palette, Ruler,
    ClipboardList, IndianRupee, FileBarChart, Receipt,
    Settings, LogOut, Menu, X, UserCog, CalendarDays, Wallet, Bell, Check, History, ShieldCheck
} from 'lucide-react';

/** Grouped so a 14-item sidebar reads as four short lists instead of one wall. */
const navGroups = [
    {
        label: 'Overview',
        items: [
            { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'accounts', 'data_entry'] },
        ],
    },
    {
        label: 'Production',
        items: [
            { path: '/lots', label: 'Lots', icon: Package, roles: ['admin', 'accounts'] },
            { path: '/production', label: 'Production', icon: ClipboardList, roles: ['admin', 'data_entry'] },
            { path: '/weeks', label: 'Weeks', icon: CalendarDays, roles: ['admin'] },
            { path: '/approvals', label: 'Approvals', icon: ShieldCheck, roles: ['admin', 'accounts', 'data_entry'] },
        ],
    },
    {
        label: 'Finance',
        items: [
            { path: '/advances', label: 'Advances', icon: Wallet, roles: ['admin', 'accounts'] },
            { path: '/payroll', label: 'Payroll', icon: IndianRupee, roles: ['admin', 'accounts'] },
            { path: '/vouchers', label: 'Vouchers', icon: Receipt, roles: ['admin', 'accounts'] },
            { path: '/reports', label: 'Reports', icon: FileBarChart, roles: ['admin', 'accounts'] },
        ],
    },
    {
        label: 'Master data',
        items: [
            { path: '/operators', label: 'Operators', icon: Users, roles: ['admin'] },
            { path: '/operations', label: 'Operations', icon: Scissors, roles: ['admin'] },
            { path: '/colors', label: 'Colors', icon: Palette, roles: ['admin'] },
            { path: '/size-charts', label: 'Size Charts', icon: Ruler, roles: ['admin'] },
        ],
    },
    {
        label: 'System',
        items: [
            { path: '/users', label: 'Users', icon: UserCog, roles: ['admin'] },
            { path: '/enquiries', label: 'Enquiries', icon: Bell, roles: ['admin'] },
            { path: '/audit', label: 'Activity log', icon: History, roles: ['admin'] },
            { path: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] },
        ],
    },
];

// Trimmed marks. The original artwork is a 1394x711 canvas holding a 958x199
// logo, so ~62% of the file is empty margin -- `object-contain` was fitting the
// padding and rendering the wordmark tiny. These are cropped to the ink.
const LOGO_WHITE = "/victoria-logo-mark.png";

const isActive = (path, pathname) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path);

export default function Layout({ children }) {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [pendingApprovals, setPendingApprovals] = useState(0);
    const [notifOpen, setNotifOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const notifRef = useRef(null);

    useEffect(() => {
        const loadNotifs = () => {
            api.get('/notifications/unread-count')
                .then(r => setUnread(r.data.count))
                .catch(err => console.error('Notif count failed:', err));
        };
        const loadApprovals = () => {
            api.get('/approvals/pending-count').then(r => setPendingApprovals(r.data.count)).catch(() => {});
        };
        loadNotifs();
        loadApprovals();
        const interval = setInterval(() => { loadNotifs(); loadApprovals(); }, 30000);
        // the Approvals page tells us right away when it changes the count
        window.addEventListener('approvals-changed', loadApprovals);
        return () => { clearInterval(interval); window.removeEventListener('approvals-changed', loadApprovals); };
    }, []);

    // Close the notification panel on outside click / Escape rather than
    // leaving it stuck open until the bell is pressed again.
    useEffect(() => {
        if (!notifOpen) return;
        const onDown = (e) => {
            if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setNotifOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [notifOpen]);

    // Lock body scroll while the mobile drawer is open.
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    const openNotifs = async () => {
        const next = !notifOpen;
        setNotifOpen(next);
        if (next) {
            try {
                const r = await api.get('/notifications');
                setNotifications(r.data.slice(0, 15));
                await api.put('/notifications/read-all');
                setUnread(0);
            } catch (err) { console.error('Notifications load failed:', err); }
        }
    };

    const groups = navGroups
        .map(g => ({ ...g, items: g.items.filter(i => i.roles.includes(user?.role)) }))
        .filter(g => g.items.length > 0);

    const currentLabel = groups
        .flatMap(g => g.items)
        .find(n => isActive(n.path, location.pathname))?.label || '';

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    let navIndex = 0;

    return (
        <div className="flex h-screen bg-background" data-testid="app-layout">
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col bg-brand-700
                    transition-transform duration-300 ease-out-soft lg:static lg:translate-x-0
                    ${open ? 'translate-x-0 shadow-pop' : '-translate-x-full'}`}
            >
                {/* Brand block */}
                <div className="shrink-0 bg-white px-4 pb-2 pt-3.5">
                    <img src={LOGO_WHITE} alt="Victoria Garments" className="w-full"
                        data-testid="sidebar-logo" />
                    <p className="pt-2 text-center text-[8.5px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                        Unit Flow
                    </p>
                </div>
                <div className="rule-brand h-px w-full" />

                <nav className="scroll-dark flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2.5">
                    {groups.map(group => (
                        <div key={group.label}>
                            <p className="px-2.5 pb-1 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-white/35">
                                {group.label}
                            </p>
                            <div className="space-y-0.5">
                                {group.items.map(item => {
                                    const active = isActive(item.path, location.pathname);
                                    const i = navIndex++;
                                    return (
                                        <Link
                                            key={item.path}
                                            to={item.path}
                                            onClick={() => setOpen(false)}
                                            style={{ '--i': i }}
                                            data-testid={`nav-${item.label.toLowerCase()}`}
                                            className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[5.5px]
                                                text-[12.5px] font-medium transition-all duration-150 ease-out-soft
                                                ${active
                                                    ? 'bg-white text-brand-700 shadow-float'
                                                    : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
                                        >
                                            {/* active rail */}
                                            <span className={`absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full
                                                bg-leaf transition-all duration-200 ease-spring
                                                ${active ? 'opacity-100' : 'scale-y-0 opacity-0'}`} />
                                            <item.icon
                                                size={15}
                                                strokeWidth={active ? 2.3 : 1.8}
                                                className="transition-transform duration-200 ease-out-soft group-hover:scale-110"
                                            />
                                            {item.label}
                                            {item.path === '/approvals' && pendingApprovals > 0 && (
                                                <span className="ml-auto grid h-4 min-w-[16px] place-items-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-amber-950"
                                                    data-testid="approvals-badge">{pendingApprovals > 9 ? '9+' : pendingApprovals}</span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className="shrink-0 border-t border-white/10 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-leaf text-[11px] font-bold text-white">
                            {user?.name?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] font-medium text-white/90">{user?.name}</div>
                            <div className="text-[10px] capitalize text-white/45">{user?.role?.replace('_', ' ')}</div>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        data-testid="logout-button"
                        className="press mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md
                            py-1.5 text-[11.5px] text-white/45 hover:bg-white/10 hover:text-white"
                    >
                        <LogOut size={12} /> Sign out
                    </button>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-12 shrink-0 items-center border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
                    <button
                        onClick={() => setOpen(!open)}
                        className="press mr-3 cursor-pointer text-slate-600 lg:hidden"
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        data-testid="mobile-menu-toggle"
                    >
                        {open ? <X size={19} /> : <Menu size={19} />}
                    </button>
                    <img src={LOGO_WHITE} alt="Victoria" className="mr-3 h-4 lg:hidden" />
                    <span className="font-outfit text-[13.5px] font-medium text-slate-700">{currentLabel}</span>

                    <div className="relative ml-auto flex items-center gap-2" ref={notifRef}>
                        <button
                            onClick={openNotifs}
                            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                            className="press relative cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            data-testid="notification-bell"
                        >
                            <Bell size={17} />
                            {unread > 0 && (
                                <span className="animate-pop absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center
                                    rounded-full bg-leaf px-1 text-[9px] font-bold text-white">
                                    {unread > 9 ? '9+' : unread}
                                </span>
                            )}
                        </button>
                        {notifOpen && (
                            <div
                                className="animate-pop absolute right-0 top-10 z-50 w-[330px] origin-top-right overflow-hidden
                                    rounded-xl border border-border bg-card shadow-pop"
                                data-testid="notification-panel"
                            >
                                <div className="flex items-center justify-between border-b border-border bg-slate-50 px-3 py-2">
                                    <span className="text-[11.5px] font-semibold text-slate-700">Notifications</span>
                                    <button
                                        onClick={async () => {
                                            await api.delete('/notifications/clear-all');
                                            setNotifications([]); setUnread(0); toast.success('Notifications cleared');
                                        }}
                                        className="cursor-pointer text-[10.5px] font-medium text-slate-400 hover:text-rose-600"
                                        data-testid="clear-all-notifs"
                                    >
                                        Clear all
                                    </button>
                                </div>
                                <div className="stagger-fast max-h-72 overflow-y-auto">
                                    {notifications.length > 0 ? notifications.map((n, idx) => (
                                        <button
                                            key={n.id}
                                            style={{ '--i': idx }}
                                            onClick={async () => {
                                                await api.put(`/notifications/${n.id}/toggle`);
                                                setNotifications(notifications.map(x =>
                                                    x.id === n.id ? { ...x, read: !x.read } : x));
                                            }}
                                            className={`flex w-full cursor-pointer items-start gap-2 border-b border-border/60 px-3 py-2
                                                text-left transition-colors hover:bg-slate-50
                                                ${n.read ? 'text-slate-400' : 'bg-brand-50/40 text-slate-700'}`}
                                        >
                                            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full
                                                ${n.read ? 'bg-slate-300' : 'bg-leaf'}`} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[12px] leading-snug">{n.message}</span>
                                                <span className="mt-0.5 block text-[9.5px] text-slate-400">
                                                    {n.created_at?.split('T')[0]}
                                                </span>
                                            </span>
                                        </button>
                                    )) : (
                                        <div className="flex flex-col items-center px-3 py-8 text-center">
                                            <Check size={18} className="mb-1.5 text-slate-300" />
                                            <p className="text-[12px] text-slate-400">You're all caught up</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </header>

                {/* keyed on pathname so each route re-runs its entry animation */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-5">
                    <div key={location.pathname} className="animate-fade-in mx-auto max-w-[1500px]">
                        {children}
                    </div>
                </main>
            </div>

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    className="animate-fade-in fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px] lg:hidden"
                />
            )}
        </div>
    );
}
