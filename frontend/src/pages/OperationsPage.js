import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { PageHeader } from '../components/ui/primitives';
import { Plus, Pencil, Trash2, Search, Scissors } from 'lucide-react';

export default function OperationsPage() {
    const [operations, setOperations] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [search, setSearch] = useState('');

    const load = () => api.get('/operations').then(r => setOperations(r.data)).catch(() => toast.error('Failed to load'));
    useEffect(() => { load(); }, []);

    const filtered = operations.filter(o => o.name?.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name is required');
        try {
            if (editing) {
                await api.put(`/operations/${editing.id}`, { name: name.trim() });
                toast.success('Operation updated');
            } else {
                await api.post('/operations', { name: name.trim() });
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

    return (
        <div className="space-y-4" data-testid="operations-page">
                <PageHeader title="Operations" subtitle="The tasks a garment passes through, each with its own piece rate" icon={Scissors}
                    actions={<>
            <Button onClick={() => { setEditing(null); setName(''); setDialogOpen(true); }} data-testid="add-operation-button">
                <Plus size={15} /> Add Operation
            </Button>
                    </>}
                />
            <div className="relative max-w-xs">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input placeholder="Search operations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" data-testid="search-operations" />
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">#</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operation Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((op, i) => (
                            <TableRow key={op.id} className="hover:bg-slate-50/80" data-testid={`operation-row-${op.id}`}>
                                <TableCell className="font-mono text-xs text-slate-500">{i + 1}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{op.name}</TableCell>
                                <TableCell>
                                    <Switch checked={op.active !== false} onCheckedChange={() => toggleActive(op)} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" onClick={() => { setEditing(op); setName(op.name); setDialogOpen(true); }} data-testid={`edit-op-${op.id}`}>
                                            <Pencil size={14} />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(op.id)} className="text-red-500 hover:text-red-700" data-testid={`delete-op-${op.id}`}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {operations.length === 0 && (
                            <TableRow><TableCell colSpan={3} className="text-center text-sm text-slate-400 py-8">No operations. Add common garment operations like Cutting, Stitching, etc.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="operation-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">{editing ? 'Edit Operation' : 'New Operation'}</DialogTitle>
                    </DialogHeader>
                    <div className="py-2">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operation Name</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cutting, Stitching..."
                            className="mt-1" data-testid="operation-name-input" autoFocus onKeyDown={e => e.key === 'Enter' && handleSave()} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-operation-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
