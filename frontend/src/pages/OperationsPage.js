import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { PageHeader } from '../components/ui/primitives';
import GroupManager from '../components/GroupManager';
import { Plus, Pencil, Trash2, Search, Scissors, Layers } from 'lucide-react';

const selectCls = 'h-9 rounded-md border border-input bg-white px-2 text-[13px]';

export default function OperationsPage() {
    const [operations, setOperations] = useState([]);
    const [groups, setGroups] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [groupsOpen, setGroupsOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');
    const [search, setSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [selected, setSelected] = useState(new Set());
    const [bulkGroup, setBulkGroup] = useState('');

    const load = () => Promise.all([api.get('/operations'), api.get('/operation-groups')])
        .then(([o, g]) => { setOperations(o.data); setGroups(g.data); })
        .catch(() => toast.error('Failed to load'));
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => operations.filter(o => {
        if (!o.name?.toLowerCase().includes(search.toLowerCase())) return false;
        if (groupFilter === 'none') return !o.group_id;
        if (groupFilter !== 'all') return o.group_id === groupFilter;
        return true;
    }), [operations, search, groupFilter]);

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name is required');
        try {
            if (editing) {
                await api.put(`/operations/${editing.id}`, { name: name.trim(), group_id: groupId });
                toast.success('Operation updated');
            } else {
                await api.post('/operations', { name: name.trim(), group_id: groupId || null });
                toast.success('Operation created');
            }
            setDialogOpen(false); setName(''); setEditing(null); load();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this operation?')) return;
        await api.delete(`/operations/${id}`); toast.success('Deleted'); load();
    };

    const toggleActive = async (op) => {
        await api.put(`/operations/${op.id}`, { active: !op.active });
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
        try {
            const r = await api.post('/operations/assign-group', { ids: [...selected], group_id: bulkGroup === 'none' ? '' : bulkGroup });
            toast.success(`${r.data.updated} operation${r.data.updated === 1 ? '' : 's'} moved to ${r.data.group_name || 'no group'}`);
            setSelected(new Set()); setBulkGroup(''); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not move operations'); }
    };

    const openEdit = (op) => { setEditing(op); setName(op.name); setGroupId(op.group_id || ''); setDialogOpen(true); };

    return (
        <div className="space-y-4" data-testid="operations-page">
            <PageHeader title="Operations" subtitle="The tasks a garment passes through, each with its own piece rate" icon={Scissors}
                actions={<>
                    <Button variant="outline" onClick={() => setGroupsOpen(true)} data-testid="manage-operation-groups">
                        <Layers size={15} /> Groups
                    </Button>
                    <Button onClick={() => { setEditing(null); setName(''); setGroupId(''); setDialogOpen(true); }} data-testid="add-operation-button">
                        <Plus size={15} /> Add Operation
                    </Button>
                </>}
            />
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input placeholder="Search operations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" data-testid="search-operations" />
                </div>
                <select className={selectCls} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                    aria-label="Filter by group" data-testid="operation-group-filter">
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
                            <TableHead className="w-10"><Checkbox checked={allShown} onCheckedChange={toggleAll} aria-label="Select all shown" /></TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">#</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operation Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Group</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((op, i) => (
                            <TableRow key={op.id} className="hover:bg-slate-50/80" data-testid={`operation-row-${op.id}`}>
                                <TableCell><Checkbox checked={selected.has(op.id)} onCheckedChange={() => toggleOne(op.id)} aria-label={`Select ${op.name}`} /></TableCell>
                                <TableCell className="font-mono text-xs text-slate-500">{i + 1}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{op.name}</TableCell>
                                <TableCell className="text-sm text-slate-600">{op.group_name || <span className="text-slate-300">—</span>}</TableCell>
                                <TableCell>
                                    <Switch checked={op.active !== false} onCheckedChange={() => toggleActive(op)} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" aria-label={`Edit ${op.name}`} onClick={() => openEdit(op)} data-testid={`edit-op-${op.id}`}>
                                            <Pencil size={14} />
                                        </Button>
                                        <Button variant="ghost" size="sm" aria-label={`Delete ${op.name}`} onClick={() => handleDelete(op.id)} className="text-red-500 hover:text-red-700" data-testid={`delete-op-${op.id}`}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filtered.length === 0 && (
                            <TableRow><TableCell colSpan={6} className="text-center text-sm text-slate-400 py-8">
                                {operations.length === 0 ? 'No operations. Add common garment operations like Cutting, Stitching, etc.' : 'No operations match.'}
                            </TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="operation-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">{editing ? 'Edit Operation' : 'New Operation'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operation Name</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Overlock, Flatlock..."
                                className="mt-1" data-testid="operation-name-input" autoFocus onKeyDown={e => e.key === 'Enter' && handleSave()} />
                        </div>
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Group (optional)</Label>
                            <select className={`${selectCls} mt-1 w-full`} value={groupId} onChange={e => setGroupId(e.target.value)} data-testid="operation-group-select">
                                <option value="">No group</option>
                                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-operation-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <GroupManager open={groupsOpen} onOpenChange={setGroupsOpen} endpoint="/operation-groups"
                title="Operation groups" noun="operation" onChanged={load} />
        </div>
    );
}
