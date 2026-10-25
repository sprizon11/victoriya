import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { PageHeader } from '../components/ui/primitives';
import GroupManager from '../components/GroupManager';
import { Plus, Pencil, Trash2, Search, Users, Layers } from 'lucide-react';

const selectCls = 'h-9 rounded-md border border-input bg-white px-2 text-[13px]';

export default function OperatorsPage() {
    const [operators, setOperators] = useState([]);
    const [groups, setGroups] = useState([]);
    const [search, setSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');          // all | none | <group id>
    const [selected, setSelected] = useState(new Set());
    const [bulkGroup, setBulkGroup] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');

    const load = () => Promise.all([api.get('/operators'), api.get('/operator-groups')])
        .then(([o, g]) => { setOperators(o.data); setGroups(g.data); })
        .catch(() => toast.error('Failed to load operators'));
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => operators.filter(o => {
        if (!o.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (groupFilter === 'none') return !o.group_id;
        if (groupFilter !== 'all') return o.group_id === groupFilter;
        return true;
    }), [operators, search, groupFilter]);

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name is required');
        try {
            if (editing) {
                await api.put(`/operators/${editing.id}`, { name: name.trim(), group_id: groupId });
                toast.success('Operator updated');
            } else {
                await api.post('/operators', { name: name.trim(), group_id: groupId || null });
                toast.success('Operator created');
            }
            setDialogOpen(false);
            setName('');
            setEditing(null);
            load();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error saving operator');
        }
    };

    const toggleActive = async (op) => {
        await api.put(`/operators/${op.id}`, { active: !op.active });
        load();
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this operator?')) return;
        await api.delete(`/operators/${id}`);
        toast.success('Deleted');
        load();
    };

    const toggleOne = (id) => setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const allShown = filtered.length > 0 && filtered.every(o => selected.has(o.id));
    const toggleAll = () => setSelected(allShown ? new Set() : new Set(filtered.map(o => o.id)));

    const applyBulk = async () => {
        if (selected.size === 0) return;
        try {
            const r = await api.post('/operators/assign-group', { ids: [...selected], group_id: bulkGroup === 'none' ? '' : bulkGroup });
            toast.success(`${r.data.updated} operator${r.data.updated === 1 ? '' : 's'} moved to ${r.data.group_name || 'no group'}`);
            setSelected(new Set()); setBulkGroup(''); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not move operators'); }
    };

    const openEdit = (op) => { setEditing(op); setName(op.name); setGroupId(op.group_id || ''); setDialogOpen(true); };
    const openNew = () => { setEditing(null); setName(''); setGroupId(''); setDialogOpen(true); };

    return (
        <div className="space-y-4" data-testid="operators-page">
            <PageHeader title="Operators" subtitle="The people on the floor, with auto-assigned codes" icon={Users}
                actions={<>
                    <Button variant="outline" onClick={() => setGroupsOpen(true)} data-testid="manage-operator-groups">
                        <Layers size={15} /> Groups
                    </Button>
                    <Button onClick={openNew} data-testid="add-operator-button">
                        <Plus size={15} /> Add Operator
                    </Button>
                </>}
            />
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input placeholder="Search operators..." value={search} onChange={e => setSearch(e.target.value)}
                        className="pl-9 bg-white" data-testid="search-operators" />
                </div>
                <select className={selectCls} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                    aria-label="Filter by group" data-testid="operator-group-filter">
                    <option value="all">All groups</option>
                    <option value="none">No group</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>)}
                </select>
            </div>

            {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/20 bg-brand-50 px-3 py-2" data-testid="bulk-bar">
                    <span className="text-[12.5px] font-medium text-brand">{selected.size} selected</span>
                    <select className={selectCls} value={bulkGroup} onChange={e => setBulkGroup(e.target.value)}
                        aria-label="Move to group" data-testid="bulk-group-select">
                        <option value="" disabled>Move to…</option>
                        <option value="none">No group</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <Button size="sm" disabled={!bulkGroup} onClick={applyBulk} data-testid="bulk-apply">Apply</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
            )}

            <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead className="w-10"><Checkbox checked={allShown} onCheckedChange={toggleAll} aria-label="Select all shown" data-testid="select-all-operators" /></TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Code</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Group</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((op) => (
                            <TableRow key={op.id} className="hover:bg-slate-50/80 transition-colors" data-testid={`operator-row-${op.id}`}>
                                <TableCell><Checkbox checked={selected.has(op.id)} onCheckedChange={() => toggleOne(op.id)} aria-label={`Select ${op.name}`} data-testid={`select-${op.id}`} /></TableCell>
                                <TableCell className="font-mono text-xs text-blue-600 font-semibold">{op.operator_code || '-'}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{op.name} <span className="text-xs text-slate-400">({op.operator_code})</span></TableCell>
                                <TableCell className="text-sm text-slate-600">{op.group_name || <span className="text-slate-300">—</span>}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Switch checked={op.active} onCheckedChange={() => toggleActive(op)} data-testid={`toggle-${op.id}`} />
                                        <Badge variant={op.active ? 'default' : 'secondary'} className={op.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}>
                                            {op.active ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" aria-label={`Edit ${op.name}`} onClick={() => openEdit(op)} data-testid={`edit-${op.id}`}>
                                            <Pencil size={14} />
                                        </Button>
                                        <Button variant="ghost" size="sm" aria-label={`Delete ${op.name}`} onClick={() => handleDelete(op.id)} className="text-red-500 hover:text-red-700" data-testid={`delete-${op.id}`}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filtered.length === 0 && (
                            <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-400 py-8">No operators found</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="operator-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">{editing ? 'Edit Operator' : 'New Operator'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Operator name" className="mt-1"
                                data-testid="operator-name-input" autoFocus onKeyDown={e => e.key === 'Enter' && handleSave()} />
                        </div>
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Group (optional)</Label>
                            <select className={`${selectCls} mt-1 w-full`} value={groupId} onChange={e => setGroupId(e.target.value)} data-testid="operator-group-select">
                                <option value="">No group</option>
                                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-operator-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <GroupManager open={groupsOpen} onOpenChange={setGroupsOpen} endpoint="/operator-groups"
                title="Operator groups" noun="operator" onChanged={load} />
        </div>
    );
}
