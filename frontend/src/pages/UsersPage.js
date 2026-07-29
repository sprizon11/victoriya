import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { PageHeader, Panel, EmptyState, Pill, FieldLabel } from '../components/ui/primitives';
import {
    Plus, Trash2, Pencil, KeyRound, UserCog, ShieldCheck, Shield, Eye, PenLine, Ban,
} from 'lucide-react';

const ROLE_META = {
    admin: { label: 'Admin', tone: 'rose', blurb: 'Full access to everything' },
    accounts: { label: 'Accounts', tone: 'brand', blurb: 'Payroll, advances, reports' },
    data_entry: { label: 'Data entry', tone: 'green', blurb: 'Production entry only' },
};

const PERMISSIONS = [
    { key: 'can_enter', label: 'Record production', icon: PenLine },
    { key: 'can_edit', label: 'Edit records', icon: Pencil },
    { key: 'can_delete', label: 'Delete records', icon: Trash2 },
    { key: 'can_view_financial', label: 'View financial data', icon: Eye },
];

const emptyForm = {
    email: '', password: '', name: '', role: 'data_entry',
    can_enter: true, can_edit: false, can_delete: false, can_view_financial: false,
};

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [pwDialog, setPwDialog] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(emptyForm);

    const load = () => {
        setLoading(true);
        api.get('/users')
            .then(r => setUsers(r.data))
            .catch(() => toast.error('Could not load users'))
            .finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const resetForm = () => setForm(emptyForm);
    const openNew = () => { setEditing(null); resetForm(); setDialogOpen(true); };

    const openEdit = (u) => {
        setEditing(u);
        setForm({
            email: u.email, password: '', name: u.name, role: u.role,
            can_enter: u.can_enter !== false, can_edit: u.can_edit === true,
            can_delete: u.can_delete === true, can_view_financial: u.can_view_financial === true,
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.name.trim()) return toast.error('Name is required');
        setBusy(true);
        try {
            if (editing) {
                await api.put(`/users/${editing.id}`, {
                    name: form.name, role: form.role, can_enter: form.can_enter,
                    can_edit: form.can_edit, can_delete: form.can_delete,
                    can_view_financial: form.can_view_financial,
                });
                toast.success(`${form.name} updated`);
            } else {
                if (!form.email || !form.password) return toast.error('Email and password are required');
                await api.post('/users', form);
                toast.success(`${form.name} added`);
            }
            setDialogOpen(false); resetForm(); setEditing(null); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
        finally { setBusy(false); }
    };

    const handleDelete = async (u) => {
        if (!window.confirm(`Delete the account for ${u.name}?`)) return;
        try {
            await api.delete(`/users/${u.id}`);
            toast.success('User deleted'); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    const handleResetPassword = async () => {
        if (!newPassword || newPassword.length < 4) return toast.error('Password must be at least 4 characters');
        setBusy(true);
        try {
            await api.post(`/users/${pwDialog.id}/change-password`, { new_password: newPassword });
            toast.success(`Password reset for ${pwDialog.name}`);
            setPwDialog(null); setNewPassword('');
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
        finally { setBusy(false); }
    };

    const togglePerm = async (u, field, value) => {
        // optimistic - the switch should move under the finger, not after a round trip
        setUsers(prev => prev.map(x => x.id === u.id ? { ...x, [field]: value } : x));
        try {
            await api.put(`/users/${u.id}`, { [field]: value });
        } catch (err) {
            setUsers(prev => prev.map(x => x.id === u.id ? { ...x, [field]: !value } : x));
            toast.error(err.response?.data?.detail || 'Could not update permission');
        }
    };

    const counts = users.reduce((acc, u) => {
        acc[u.role] = (acc[u.role] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="space-y-4" data-testid="users-page">
            <PageHeader
                title="Users & permissions"
                subtitle="Accounts, roles, and exactly what each person is allowed to do"
                icon={UserCog}
                actions={
                    <Button onClick={openNew} data-testid="add-user-button">
                        <Plus size={15} /> Add user
                    </Button>
                }
            />

            <div className="flex flex-wrap gap-2">
                {Object.entries(ROLE_META).map(([role, meta]) => (
                    <div key={role}
                        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-xs">
                        <Pill tone={meta.tone}>{meta.label}</Pill>
                        <span className="tnum text-[12.5px] font-semibold text-slate-800">{counts[role] || 0}</span>
                        <span className="text-[11px] text-muted-foreground">· {meta.blurb}</span>
                    </div>
                ))}
            </div>

            {loading ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2].map(i => <div key={i} className="skeleton h-[196px] rounded-xl" />)}
                </div>
            ) : users.length === 0 ? (
                <Panel bodyClass="p-0">
                    <EmptyState icon={UserCog} title="No users yet"
                        message="Add an account for each person who needs access."
                        action={<Button onClick={openNew}><Plus size={14} /> Add the first user</Button>} />
                </Panel>
            ) : (
                <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {users.map((u, i) => {
                        const meta = ROLE_META[u.role] || ROLE_META.data_entry;
                        const isAdmin = u.role === 'admin';
                        return (
                            <div key={u.id} style={{ '--i': i }}
                                className="lift flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card"
                                data-testid={`user-row-${u.id}`}>
                                <div className="flex items-start gap-3 px-3.5 pb-3 pt-3.5">
                                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white
                                        ${isAdmin ? 'bg-brand' : u.role === 'accounts' ? 'bg-brand-600' : 'bg-leaf'}`}>
                                        {u.name?.[0]?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-outfit text-[14px] font-semibold text-slate-900">{u.name}</p>
                                        <p className="truncate text-[11.5px] text-muted-foreground">{u.email}</p>
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            <Pill tone={meta.tone}>{meta.label}</Pill>
                                            {u.active === false && <Pill tone="slate"><Ban size={9} /> Inactive</Pill>}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-0.5">
                                        <Button variant="ghost" size="iconSm" title="Edit user"
                                            className="text-brand" onClick={() => openEdit(u)}
                                            data-testid={`edit-user-${u.id}`}>
                                            <Pencil size={13} />
                                        </Button>
                                        <Button variant="ghost" size="iconSm" title="Reset password"
                                            className="text-amber-600"
                                            onClick={() => { setPwDialog(u); setNewPassword(''); }}
                                            data-testid={`reset-pw-${u.id}`}>
                                            <KeyRound size={13} />
                                        </Button>
                                        <Button variant="ghost" size="iconSm" title="Delete user"
                                            className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                            onClick={() => handleDelete(u)}
                                            data-testid={`delete-user-${u.id}`}>
                                            <Trash2 size={13} />
                                        </Button>
                                    </div>
                                </div>

                                <div className="mt-auto border-t border-border/70 bg-slate-50/60 px-3.5 py-2.5">
                                    {isAdmin ? (
                                        <p className="flex items-center gap-1.5 text-[11.5px] text-brand">
                                            <ShieldCheck size={13} />
                                            Administrator — every permission is granted and cannot be reduced.
                                        </p>
                                    ) : (
                                        <>
                                            <p className="mb-1.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                                                <Shield size={10} /> Permissions
                                            </p>
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                                {PERMISSIONS.map(p => (
                                                    <label key={p.key}
                                                        className="flex cursor-pointer items-center justify-between gap-2 py-0.5">
                                                        <span className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
                                                            <p.icon size={11} className="text-slate-400" />
                                                            {p.label}
                                                        </span>
                                                        <Switch
                                                            checked={u[p.key] === true}
                                                            onCheckedChange={v => togglePerm(u, p.key, v)}
                                                            data-testid={`perm-${p.key.replace('can_', '')}-${u.id}`}
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <p className="text-[11.5px] text-muted-foreground">
                Permissions are enforced on the server, not just hidden in the interface — a user
                without <span className="font-medium text-slate-700">View financial data</span> cannot
                reach payroll or wage figures even by URL.
            </p>

            {/* ------------------------------------------------- user dialog */}
            <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { setEditing(null); resetForm(); } setDialogOpen(v); }}>
                <DialogContent className="sm:max-w-lg" data-testid="user-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">{editing ? `Edit ${editing.name}` : 'New user'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="mb-1 block"><FieldLabel required>Name</FieldLabel></Label>
                                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder="Full name" data-testid="user-name-input" />
                            </div>
                            <div>
                                <Label className="mb-1 block"><FieldLabel required>Role</FieldLabel></Label>
                                <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                                    <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Admin — full access</SelectItem>
                                        <SelectItem value="accounts">Accounts — payroll & reports</SelectItem>
                                        <SelectItem value="data_entry">Data entry — production only</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {!editing ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="mb-1 block"><FieldLabel required>Email</FieldLabel></Label>
                                    <Input type="email" value={form.email}
                                        onChange={e => setForm({ ...form, email: e.target.value })}
                                        placeholder="user@example.com" data-testid="user-email-input" />
                                </div>
                                <div>
                                    <Label className="mb-1 block"><FieldLabel required>Password</FieldLabel></Label>
                                    <Input type="password" value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                        placeholder="Minimum 4 characters" data-testid="user-password-input" />
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-muted-foreground">
                                Email <span className="font-medium text-slate-800">{editing.email}</span> cannot be changed.
                            </div>
                        )}

                        <div className="rounded-lg border border-border bg-slate-50/70 p-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                                Permissions
                            </p>
                            {form.role === 'admin' ? (
                                <p className="flex items-center gap-1.5 text-[12px] text-brand">
                                    <ShieldCheck size={13} /> Admins always hold every permission.
                                </p>
                            ) : (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    {PERMISSIONS.map(p => (
                                        <label key={p.key} className="flex cursor-pointer items-center justify-between gap-2">
                                            <span className="text-[12.5px] text-slate-700">{p.label}</span>
                                            <Switch checked={form[p.key]}
                                                onCheckedChange={v => setForm({ ...form, [p.key]: v })} />
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialogOpen(false); setEditing(null); resetForm(); }}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} loading={busy} data-testid="save-user-button">
                            {editing ? 'Save changes' : 'Create user'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ---------------------------------------------- password dialog */}
            <Dialog open={!!pwDialog} onOpenChange={() => { setPwDialog(null); setNewPassword(''); }}>
                <DialogContent className="sm:max-w-sm" data-testid="password-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Reset password</DialogTitle></DialogHeader>
                    {pwDialog && (
                        <div className="space-y-3 py-1">
                            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-muted-foreground">
                                For <span className="font-medium text-slate-800">{pwDialog.name}</span> ({pwDialog.email})
                            </div>
                            <div>
                                <Label className="mb-1 block"><FieldLabel required>New password</FieldLabel></Label>
                                <Input type="password" value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    placeholder="Minimum 4 characters"
                                    data-testid="new-password-input" autoFocus />
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    Share it with them directly and ask them to change it after signing in.
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPwDialog(null)}>Cancel</Button>
                        <Button onClick={handleResetPassword} loading={busy} data-testid="confirm-reset-pw">
                            Reset password
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
