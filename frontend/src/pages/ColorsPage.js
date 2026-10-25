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
import { Plus, Pencil, Trash2, Search, Palette } from 'lucide-react';

export default function ColorsPage() {
    const [colors, setColors] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [search, setSearch] = useState('');

    const load = () => api.get('/colors').then(r => setColors(r.data)).catch(() => toast.error('Failed to load'));
    useEffect(() => { load(); }, []);

    const filtered = colors.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name required');
        try {
            if (editing) {
                await api.put(`/colors/${editing.id}`, { name: name.trim() });
                toast.success('Color updated');
            } else {
                await api.post('/colors', { name: name.trim() });
                toast.success('Color added');
            }
            setDialogOpen(false); setName(''); setEditing(null); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this color?')) return;
        await api.delete(`/colors/${id}`); toast.success('Deleted'); load();
    };

    const toggleActive = async (c) => {
        await api.put(`/colors/${c.id}`, { active: !c.active });
        load();
    };

    return (
        <div className="space-y-4" data-testid="colors-page">
                <PageHeader title="Colours" subtitle="Colour master used when creating lots" icon={Palette}
                    actions={<>
            <Button onClick={() => { setEditing(null); setName(''); setDialogOpen(true); }} data-testid="add-color-button">
                <Plus size={15} /> Add Color
            </Button>
                    </>}
                />
            <div className="relative max-w-xs">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input placeholder="Search colors..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" data-testid="search-colors" />
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">#</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Color Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((c, i) => (
                            <TableRow key={c.id} className="hover:bg-slate-50/80" data-testid={`color-row-${c.id}`}>
                                <TableCell className="font-mono text-xs text-slate-500">{i + 1}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{c.name}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Switch checked={c.active !== false} onCheckedChange={() => toggleActive(c)} data-testid={`color-toggle-${c.id}`} />
                                        <Badge variant={c.active !== false ? 'default' : 'secondary'} className={c.active !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]' : 'text-[10px]'}>
                                            {c.active !== false ? 'Active' : 'Disabled'}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => { setEditing(c); setName(c.name); setDialogOpen(true); }}><Pencil size={14} /></Button>
                                        <Button variant="ghost" size="sm" aria-label={`Delete ${c.name}`} onClick={() => handleDelete(c.id)} className="text-red-500"><Trash2 size={14} /></Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {colors.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-slate-400 py-8">No colors. Add common garment colors.</TableCell></TableRow>}
                    </TableBody>
                </Table>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="color-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{editing ? 'Edit Color' : 'New Color'}</DialogTitle></DialogHeader>
                    <div className="py-2">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Color Name</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Red, Blue, Navy..." className="mt-1" data-testid="color-name-input" autoFocus onKeyDown={e => e.key === 'Enter' && handleSave()} />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-color-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
