import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { PageHeader } from '../components/ui/primitives';
import { Plus, Pencil, Trash2, Search, Users } from 'lucide-react';

export default function OperatorsPage() {
    const [operators, setOperators] = useState([]);
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');

    const load = () => api.get('/operators').then(r => setOperators(r.data)).catch(() => toast.error('Failed to load operators'));
    useEffect(() => { load(); }, []);

    const filtered = operators.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name is required');
        try {
            if (editing) {
                await api.put(`/operators/${editing.id}`, { name: name.trim() });
                toast.success('Operator updated');
            } else {
                await api.post('/operators', { name: name.trim() });
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

    const openEdit = (op) => { setEditing(op); setName(op.name); setDialogOpen(true); };
    const openNew = () => { setEditing(null); setName(''); setDialogOpen(true); };

    return (
        <div className="space-y-4" data-testid="operators-page">
                <PageHeader title="Operators" subtitle="The people on the floor, with auto-assigned codes" icon={Users}
                    actions={<>
            <Button onClick={openNew} data-testid="add-operator-button">
                <Plus size={15} /> Add Operator
            </Button>
                    </>}
                />
            <div className="relative max-w-xs">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input placeholder="Search operators..." value={search} onChange={e => setSearch(e.target.value)}
                    className="pl-9 bg-white" data-testid="search-operators" />
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Code</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((op, i) => (
                            <TableRow key={op.id} className="hover:bg-slate-50/80 transition-colors" data-testid={`operator-row-${op.id}`}>
                                <TableCell className="font-mono text-xs text-blue-600 font-semibold">{op.operator_code || '-'}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{op.name} <span className="text-xs text-slate-400">({op.operator_code})</span></TableCell>
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
                                        <Button variant="ghost" size="sm" onClick={() => openEdit(op)} data-testid={`edit-${op.id}`}>
                                            <Pencil size={14} />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(op.id)} className="text-red-500 hover:text-red-700" data-testid={`delete-${op.id}`}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {filtered.length === 0 && (
                            <TableRow><TableCell colSpan={4} className="text-center text-sm text-slate-400 py-8">No operators found</TableCell></TableRow>
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
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-operator-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
