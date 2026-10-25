import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { PageHeader } from '../components/ui/primitives';
import { Plus, Trash2, Zap, CalendarDays } from 'lucide-react';

export default function WeeksPage() {
    const [weeks, setWeeks] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [genOpen, setGenOpen] = useState(false);
    const [form, setForm] = useState({ week_number: '', year: new Date().getFullYear(), start_date: '', end_date: '' });
    const [genForm, setGenForm] = useState({ year: new Date().getFullYear(), start_date: '' });

    const load = () => api.get('/weeks').then(r => setWeeks(r.data)).catch(() => toast.error('Failed to load'));
    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (!form.week_number || !form.start_date || !form.end_date) return toast.error('All fields required');
        try {
            await api.post('/weeks', { ...form, week_number: parseInt(form.week_number), year: parseInt(form.year) });
            toast.success('Week created');
            setDialogOpen(false); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    const handleGenerate = async () => {
        if (!genForm.start_date) return toast.error('Start date required');
        try {
            const r = await api.post(`/weeks/generate?year=${genForm.year}&start_date=${genForm.start_date}&week_start_day=monday`);
            toast.success(r.data.message);
            setGenOpen(false); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this week?')) return;
        try {
            await api.delete(`/weeks/${id}`);
            toast.success('Deleted'); load();
        } catch { toast.error('Cannot delete - week may have production entries'); }
    };

    return (
        <div className="space-y-4" data-testid="weeks-page">
            <PageHeader title="Payroll weeks" subtitle="Define the weeks that production and wages are grouped into" icon={CalendarDays}
                actions={<>
                    <Button variant="outline" onClick={() => setGenOpen(true)} data-testid="generate-weeks-button">
                        <Zap size={15} /> Auto generate
                    </Button>
                    <Button onClick={() => setDialogOpen(true)} data-testid="add-week-button">
                        <Plus size={15} /> Add week
                    </Button>
                </>}
            />

            <Card className="border-slate-200">
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Week #</TableHead>
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Year</TableHead>
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">Start Date</TableHead>
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">End Date</TableHead>
                                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 w-20 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {weeks.map(w => (
                                    <TableRow key={w.id} className="hover:bg-slate-50/80" data-testid={`week-row-${w.id}`}>
                                        <TableCell className="font-mono text-sm font-semibold text-blue-600">W{w.week_number}</TableCell>
                                        <TableCell className="font-mono text-sm">{w.year}</TableCell>
                                        <TableCell className="text-sm">{w.start_date}</TableCell>
                                        <TableCell className="text-sm">{w.end_date}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" aria-label={`Delete week ${w.week_number}`} onClick={() => handleDelete(w.id)} className="text-red-500"><Trash2 size={14} /></Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {weeks.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-slate-400 py-8">No weeks defined. Use Auto Generate to create weeks for the year.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="week-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Add Week</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Week Number</Label>
                                <Input type="number" value={form.week_number} onChange={e => setForm({ ...form, week_number: e.target.value })} className="mt-1 font-mono" min="1" max="53" data-testid="week-number-input" />
                            </div>
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Year</Label>
                                <Input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} className="mt-1 font-mono" data-testid="week-year-input" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Start Date</Label>
                                <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="mt-1" data-testid="week-start-input" />
                            </div>
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">End Date</Label>
                                <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="mt-1" data-testid="week-end-input" />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} data-testid="save-week-button">Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={genOpen} onOpenChange={setGenOpen}>
                <DialogContent className="sm:max-w-md" data-testid="generate-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Auto Generate Weeks</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                        <p className="text-xs text-slate-500">Generates weekly intervals (7 days each) from the start date until year end.</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Year</Label>
                                <Input type="number" value={genForm.year} onChange={e => setGenForm({ ...genForm, year: parseInt(e.target.value) })} className="mt-1 font-mono" data-testid="gen-year-input" />
                            </div>
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Start Date</Label>
                                <Input type="date" value={genForm.start_date} onChange={e => setGenForm({ ...genForm, start_date: e.target.value })} className="mt-1" data-testid="gen-start-input" />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button>
                        <Button onClick={handleGenerate} data-testid="generate-button">Generate</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
