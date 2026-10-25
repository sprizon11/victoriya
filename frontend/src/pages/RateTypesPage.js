import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, Pencil, Trash2, Coins } from 'lucide-react';
import { PageHeader, Panel, Pill, EmptyState } from '../components/ui/primitives';

const EMPTY = { name: '', code: '', counts_toward_plan: true, cap_pct_of_plan: '', cap_pieces: '' };

export default function RateTypesPage() {
    const [types, setTypes] = useState([]);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);

    const load = useCallback(() => api.get('/rate-types').then(r => setTypes(r.data)).catch(() => toast.error('Could not load rate types')), []);
    useEffect(() => { load(); }, [load]);

    const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
    const openEdit = (t) => {
        setEditing(t);
        setForm({ name: t.name, code: t.code || '', counts_toward_plan: t.counts_toward_plan,
            cap_pct_of_plan: t.cap_pct_of_plan ?? '', cap_pieces: t.cap_pieces ?? '' });
        setOpen(true);
    };

    const save = async () => {
        if (!form.name.trim()) return toast.error('Name is required');
        const body = { name: form.name.trim(), code: form.code.trim(), counts_toward_plan: form.counts_toward_plan,
            cap_pct_of_plan: form.cap_pct_of_plan === '' ? null : parseFloat(form.cap_pct_of_plan),
            cap_pieces: form.cap_pieces === '' ? null : parseInt(form.cap_pieces, 10) };
        try {
            if (editing) {
                await api.put(`/rate-types/${editing.id}`, { ...body, clear_caps: body.cap_pct_of_plan === null && body.cap_pieces === null });
                toast.success('Rate type updated');
            } else {
                await api.post('/rate-types', body);
                toast.success('Rate type added');
            }
            setOpen(false); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 7000 }); }
    };

    const toggle = async (t) => {
        try { await api.put(`/rate-types/${t.id}`, { active: !t.active }); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not change that'); }
    };
    const makeDefault = async (t) => {
        try { await api.put(`/rate-types/${t.id}`, { is_default: true }); toast.success(`${t.name} is now the default`); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not change that'); }
    };
    const remove = async (t) => {
        if (!window.confirm(`Delete the rate type "${t.name}"?`)) return;
        try { await api.delete(`/rate-types/${t.id}`); toast.success('Deleted'); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not delete', { duration: 7000 }); }
    };

    return (
        <div className="space-y-4" data-testid="rate-types-page">
            <PageHeader title="Rate types" icon={Coins}
                subtitle="The kinds of piece rate a lot can pay: Regular, Sample, Rework… Each lot sets its own rate for the types it uses."
                actions={<Button onClick={openNew} data-testid="add-rate-type"><Plus size={15} /> Add rate type</Button>} />
            <Panel bodyClass="p-0">
                {types.length === 0 ? <EmptyState icon={Coins} title="No rate types" message="They are created automatically on first start." /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="border-b border-border bg-slate-50/90">
                                    {['Name', 'In the lot plan?', 'Cap', 'Active', ''].map(h => (
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {types.map(t => (
                                    <tr key={t.id} className="border-b border-border/60" data-testid={`rate-type-row-${t.name}`}>
                                        <td className="px-3 py-2 font-medium text-slate-800">
                                            {t.name} {t.is_default && <Pill tone="brand" className="ml-1">default</Pill>}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">
                                            {t.counts_toward_plan ? 'Yes: counts as produced' : 'No: paid, but not counted as produced'}
                                        </td>
                                        <td className="tnum px-3 py-2 text-slate-600">
                                            {t.cap_pieces != null ? `${t.cap_pieces} pcs` : ''}{t.cap_pieces != null && t.cap_pct_of_plan != null ? ' / ' : ''}
                                            {t.cap_pct_of_plan != null ? `${t.cap_pct_of_plan}% of plan` : ''}
                                            {t.cap_pieces == null && t.cap_pct_of_plan == null && <span className="text-slate-300">none</span>}
                                        </td>
                                        <td className="px-3 py-2"><Switch checked={t.active !== false} disabled={t.is_default} onCheckedChange={() => toggle(t)} aria-label={`Active: ${t.name}`} /></td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex justify-end gap-1">
                                                {!t.is_default && <Button variant="ghost" size="sm" onClick={() => makeDefault(t)}>Make default</Button>}
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`}><Pencil size={14} /></Button>
                                                {!t.is_default && <Button variant="ghost" size="sm" className="text-red-500" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></Button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
            <p className="text-[12px] text-slate-500">
                Sample and Rework pieces are paid but are not counted as produced, so they never use up a lot's plan.
                Because that is a way for pay to grow without output, set a cap if you want one, and the app tells you when
                they pass 5% of a lot's plan.
            </p>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md" data-testid="rate-type-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{editing ? 'Edit rate type' : 'New rate type'}</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-1">
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Name</Label>
                            <Input className="mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus data-testid="rate-type-name" />
                        </div>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-[13px] text-slate-700">Counts toward the lot plan
                                <span className="block text-[11px] text-slate-400">Switch off for sample or rework pieces.</span></span>
                            <Switch checked={form.counts_toward_plan} disabled={!!editing} onCheckedChange={v => setForm({ ...form, counts_toward_plan: v })} data-testid="rate-type-counts" />
                        </label>
                        {!form.counts_toward_plan && (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cap (pieces)</Label>
                                    <Input className="mt-1 font-mono" inputMode="numeric" value={form.cap_pieces} placeholder="none"
                                        onChange={e => setForm({ ...form, cap_pieces: e.target.value.replace(/\D/g, '') })} data-testid="rate-type-cap-pieces" />
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cap (% of plan)</Label>
                                    <Input className="mt-1 font-mono" inputMode="decimal" value={form.cap_pct_of_plan} placeholder="none"
                                        onChange={e => setForm({ ...form, cap_pct_of_plan: e.target.value.replace(/[^0-9.]/g, '') })} data-testid="rate-type-cap-pct" />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button onClick={save} data-testid="save-rate-type">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
