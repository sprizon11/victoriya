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
import { Plus, Pencil, Trash2, X, Search, Ruler } from 'lucide-react';

export default function SizeChartsPage() {
    const [charts, setCharts] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [name, setName] = useState('');
    const [sizes, setSizes] = useState([]);
    const [newSize, setNewSize] = useState('');
    const [search, setSearch] = useState('');

    const load = () => api.get('/size-charts').then(r => setCharts(r.data)).catch(() => toast.error('Failed to load'));
    useEffect(() => { load(); }, []);

    const filtered = charts.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()) || c.sizes?.some(s => s.toLowerCase().includes(search.toLowerCase())));

    const addSize = () => {
        if (!newSize.trim()) return;
        if (sizes.includes(newSize.trim())) return toast.error('Size already exists');
        setSizes([...sizes, newSize.trim()]);
        setNewSize('');
    };

    const removeSize = (s) => setSizes(sizes.filter(x => x !== s));

    const handleSave = async () => {
        if (!name.trim()) return toast.error('Name required');
        if (sizes.length === 0) return toast.error('Add at least one size');
        try {
            if (editing) {
                await api.put(`/size-charts/${editing.id}`, { name: name.trim(), sizes });
                toast.success('Size chart updated');
            } else {
                await api.post('/size-charts', { name: name.trim(), sizes });
                toast.success('Size chart created');
            }
            setDialogOpen(false); setName(''); setSizes([]); setEditing(null); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this size chart?')) return;
        await api.delete(`/size-charts/${id}`); toast.success('Deleted'); load();
    };

    const toggleActive = async (chart) => {
        await api.put(`/size-charts/${chart.id}`, { active: !chart.active });
        load();
    };

    const openEdit = (chart) => {
        setEditing(chart); setName(chart.name); setSizes(chart.sizes || []); setDialogOpen(true);
    };

    return (
        <div className="space-y-4" data-testid="size-charts-page">
                <PageHeader title="Size charts" subtitle="Named size sets applied to lots" icon={Ruler}
                    actions={<>
            <Button onClick={() => { setEditing(null); setName(''); setSizes([]); setDialogOpen(true); }} data-testid="add-size-chart-button">
                <Plus size={15} /> New Size Chart
            </Button>
                    </>}
                />
            <div className="relative max-w-xs">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input placeholder="Search size charts..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white" data-testid="search-sizecharts" />
            </div>
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-16">#</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Chart Name</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sizes</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-24">Status</TableHead>
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-32 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((c, i) => (
                            <TableRow key={c.id} className="hover:bg-slate-50/80" data-testid={`chart-row-${c.id}`}>
                                <TableCell className="font-mono text-xs text-slate-500">{i + 1}</TableCell>
                                <TableCell className="text-sm font-medium text-slate-800">{c.name}</TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {c.sizes?.map(s => <Badge key={s} variant="secondary" className="text-[10px] bg-blue-50 text-blue-700">{s}</Badge>)}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Switch checked={c.active !== false} onCheckedChange={() => toggleActive(c)} data-testid={`chart-toggle-${c.id}`} />
                                        <Badge variant={c.active !== false ? 'default' : 'secondary'} className={c.active !== false ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]' : 'text-[10px]'}>
                                            {c.active !== false ? 'Active' : 'Disabled'}
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil size={14} /></Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)} className="text-red-500"><Trash2 size={14} /></Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                        {charts.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-slate-400 py-8">No size charts. Create one like "S-2XL" with sizes S, M, L, XL, 2XL.</TableCell></TableRow>}
                    </TableBody>
                </Table>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg" data-testid="size-chart-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{editing ? 'Edit Size Chart' : 'New Size Chart'}</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Chart Name</Label>
                            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. S-2XL" className="mt-1" data-testid="chart-name-input" />
                        </div>
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sizes</Label>
                            <div className="flex gap-2 mt-1">
                                <Input value={newSize} onChange={e => setNewSize(e.target.value)} placeholder="e.g. S, M, L..." className="flex-1" data-testid="size-input"
                                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSize())} />
                                <Button type="button" variant="outline" onClick={addSize} data-testid="add-size-btn"><Plus size={14} /></Button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2 min-h-[32px]">
                                {sizes.map(s => (
                                    <Badge key={s} className="bg-blue-50 text-blue-700 gap-1 cursor-pointer hover:bg-blue-100" onClick={() => removeSize(s)}>
                                        {s} <X size={10} />
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} data-testid="save-chart-button">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
