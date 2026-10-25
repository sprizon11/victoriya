import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { UserPlus, Pencil, Trash2, Search, Users, FolderPlus, X } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, FieldLabel, inr } from '../components/ui/primitives';

const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]';
const decimal = (v) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const BLANK = { name: '', designation: '', emp_id: '', department: '', day_rate: '', night_rate: '', night_same: true };

export default function SalaryWorkersPage() {
    const { user } = useAuth();
    const [workers, setWorkers] = useState(null);
    const [depts, setDepts] = useState([]);
    const [dept, setDept] = useState('all');
    const [search, setSearch] = useState('');
    const [showOff, setShowOff] = useState(false);
    const [form, setForm] = useState(null);                 // null = closed; { id?, ...fields }
    const [deptOpen, setDeptOpen] = useState(false);
    const [deptName, setDeptName] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => Promise.all([api.get('/salary/workers'), api.get('/salary/departments')])
        .then(([w, d]) => { setWorkers(w.data); setDepts(d.data); }).catch(() => toast.error('Could not load workers')), []);
    useEffect(() => { load(); }, [load]);

    const shown = useMemo(() => (workers || []).filter(w => {
        if (!showOff && !w.active) return false;
        if (dept !== 'all' && w.department !== dept) return false;
        const q = search.trim().toLowerCase();
        return !q || [w.name, w.emp_id, w.designation].some(x => (x || '').toLowerCase().includes(q));
    }), [workers, dept, search, showOff]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const openAdd = () => setForm({ ...BLANK, department: dept !== 'all' ? dept : '' });
    const openEdit = (w) => setForm({ id: w.id, name: w.name, designation: w.designation || '', emp_id: w.emp_id || '', department: w.department || '',
        day_rate: String(w.day_rate), night_rate: w.night_same_as_day ? '' : String(w.night_rate), night_same: w.night_same_as_day });

    const save = async () => {
        if (!form.name.trim()) return toast.error('Enter the worker\'s name');
        if (form.day_rate === '') return toast.error('Enter the day rate');
        if (!form.night_same && form.night_rate === '') return toast.error('Enter the night rate, or tick "same as day"');
        const body = { name: form.name.trim(), designation: form.designation.trim(), emp_id: form.emp_id.trim(), department: form.department, day_rate: parseFloat(form.day_rate) };
        if (form.id) { body.night_same_as_day = form.night_same; if (!form.night_same) body.night_rate = parseFloat(form.night_rate); }
        else if (!form.night_same) body.night_rate = parseFloat(form.night_rate);
        setBusy(true);
        try {
            if (form.id) await api.put(`/salary/workers/${form.id}`, body); else await api.post('/salary/workers', body);
            toast.success(form.id ? 'Worker updated' : 'Worker added');
            setForm(null); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 8000 }); }
        finally { setBusy(false); }
    };
    const toggle = async (w) => {
        try { await api.put(`/salary/workers/${w.id}`, { active: !w.active }); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not update'); }
    };
    const remove = async (w) => {
        if (!window.confirm(`Delete ${w.name}? This only works for workers with no saved weeks.`)) return;
        try { await api.delete(`/salary/workers/${w.id}`); toast.success('Deleted'); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not delete', { duration: 8000 }); }
    };
    const addDept = async () => {
        const name = deptName.trim();
        if (!name) return;
        setDeptName('');                                   // clear at once so a quick second entry never joins onto the first
        try { await api.post('/salary/departments', { name }); toast.success('Department added'); load(); }
        catch (err) { setDeptName(name); toast.error(err.response?.data?.detail || 'Could not add'); }
    };
    const delDept = async (d) => {
        try { await api.delete(`/salary/departments/${d.id}`); if (dept === d.name) setDept('all'); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not delete', { duration: 8000 }); }
    };

    return (
        <div className="space-y-4" data-testid="salary-workers-page">
            <PageHeader title="Salary workers" icon={Users} subtitle="Everyone who is paid by the day or night shift, with their rates."
                actions={<>
                    <Button variant="outline" size="sm" onClick={() => setDeptOpen(true)} data-testid="manage-depts"><FolderPlus size={14} /> Departments</Button>
                    <Button size="sm" onClick={openAdd} data-testid="add-worker"><UserPlus size={14} /> Add worker</Button>
                </>} />

            <div className="flex flex-wrap items-center gap-2">
                {[{ name: 'all', label: 'All' }, ...depts.map(d => ({ name: d.name, label: `${d.name} (${d.workers})` }))].map(d => (
                    <button key={d.name} onClick={() => setDept(d.name)} aria-pressed={dept === d.name}
                        className={`rounded-full px-3 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors ${dept === d.name ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{d.label}</button>))}
                <div className="relative ml-auto w-full sm:w-60">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
                    <Input className="pl-8" placeholder="Search name, ID, role…" aria-label="Search workers" value={search} onChange={e => setSearch(e.target.value)} data-testid="worker-search" />
                </div>
                <label className="flex items-center gap-1.5 text-[12px] text-slate-500"><input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show switched-off</label>
            </div>

            <Panel bodyClass="p-0">
                {!workers ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10" />)}</div>
                    : shown.length === 0 ? <EmptyState icon={Users} title={workers.length ? 'No one matches' : 'No workers yet'} message={workers.length ? 'Try another department or search.' : 'Add your first worker with their day and night rate.'}
                        action={!workers.length && <Button onClick={openAdd}>Add worker</Button>} />
                        : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-[13px]" data-testid="workers-table">
                                    <thead><tr className="border-b border-border bg-slate-50/70 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <th className="px-4 py-2">Worker</th><th className="px-2 py-2">Department</th><th className="px-2 py-2 text-right">Day rate</th><th className="px-2 py-2 text-right">Night rate</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
                                    <tbody>
                                        {shown.map(w => (
                                            <tr key={w.id} className={`border-b border-border/60 last:border-0 hover:bg-slate-50/60 ${w.active ? '' : 'opacity-60'}`} data-testid="worker-row">
                                                <td className="px-4 py-2"><p className="font-medium text-slate-800">{w.name} {!w.active && <Pill>off</Pill>}</p>
                                                    <p className="text-[11px] text-slate-400">{[w.emp_id, w.designation].filter(Boolean).join(' · ') || '—'}</p></td>
                                                <td className="px-2 py-2 text-slate-600">{w.department || '—'}</td>
                                                <td className="tnum px-2 py-2 text-right">{inr(w.day_rate, { decimals: 0 })}</td>
                                                <td className="tnum px-2 py-2 text-right">{inr(w.night_rate, { decimals: 0 })}{w.night_same_as_day && <span className="block text-[10.5px] text-slate-400">same as day</span>}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                                    <Button variant="ghost" size="sm" aria-label={`Edit ${w.name}`} onClick={() => openEdit(w)}><Pencil size={14} /></Button>
                                                    <Button variant="ghost" size="sm" className="text-[11.5px]" onClick={() => toggle(w)}>{w.active ? 'Switch off' : 'Switch on'}</Button>
                                                    {user?.role === 'admin' && <Button variant="ghost" size="sm" className="text-rose-600" aria-label={`Delete ${w.name}`} onClick={() => remove(w)}><Trash2 size={14} /></Button>}
                                                </td>
                                            </tr>))}
                                    </tbody>
                                </table>
                            </div>)}
            </Panel>

            <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{form?.id ? 'Edit worker' : 'Add worker'}</DialogTitle></DialogHeader>
                    {form && (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2"><Label><FieldLabel required>Name</FieldLabel></Label><Input className="mt-1" autoFocus value={form.name} maxLength={100} onChange={e => set('name', e.target.value)} aria-label="Worker name" data-testid="w-name" /></div>
                            <div><Label><FieldLabel>Designation</FieldLabel></Label><Input className="mt-1" value={form.designation} maxLength={80} onChange={e => set('designation', e.target.value)} placeholder="e.g. Tailor" aria-label="Designation" data-testid="w-desig" /></div>
                            <div><Label><FieldLabel>Employee ID</FieldLabel></Label><Input className="mt-1" value={form.emp_id} maxLength={30} onChange={e => set('emp_id', e.target.value)} aria-label="Employee ID" data-testid="w-empid" /></div>
                            <div className="sm:col-span-2"><Label><FieldLabel>Department</FieldLabel></Label>
                                <select className={selectCls} value={form.department} onChange={e => set('department', e.target.value)} aria-label="Department" data-testid="w-dept">
                                    <option value="">None</option>{depts.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select>
                                {depts.length === 0 && <p className="mt-1 text-[11.5px] text-slate-400">No departments yet. Use the Departments button to add some.</p>}</div>
                            <div><Label><FieldLabel required>Day rate (₹ per shift)</FieldLabel></Label><Input className="mt-1 font-mono" inputMode="decimal" value={form.day_rate} onChange={e => set('day_rate', decimal(e.target.value))} aria-label="Day rate per shift" data-testid="w-day" /></div>
                            <div><Label><FieldLabel required={!form.night_same}>Night rate (₹ per shift)</FieldLabel></Label>
                                <Input className="mt-1 font-mono" inputMode="decimal" disabled={form.night_same} value={form.night_same ? form.day_rate : form.night_rate} onChange={e => set('night_rate', decimal(e.target.value))} aria-label="Night rate per shift" data-testid="w-night" /></div>
                            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-600 sm:col-span-2">
                                <input type="checkbox" checked={form.night_same} onChange={e => set('night_same', e.target.checked)} data-testid="w-same" /> Night rate is the same as the day rate
                            </label>
                        </div>)}
                    <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={save} data-testid="w-save">{form?.id ? 'Save changes' : 'Add worker'}</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Departments</DialogTitle></DialogHeader>
                    <div className="flex gap-2">
                        <Input value={deptName} maxLength={60} placeholder="e.g. Stitching, Cutting, Packing" aria-label="New department name" onChange={e => setDeptName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDept()} data-testid="dept-name" />
                        <Button onClick={addDept} data-testid="dept-add">Add</Button>
                    </div>
                    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {depts.length === 0 && <li className="px-3 py-3 text-[12.5px] text-slate-400">No departments yet.</li>}
                        {depts.map(d => (
                            <li key={d.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
                                <span>{d.name} <span className="text-[11px] text-slate-400">· {d.workers} worker{d.workers === 1 ? '' : 's'}</span></span>
                                <Button variant="ghost" size="sm" className="text-rose-600" aria-label={`Delete department ${d.name}`} onClick={() => delDept(d)}><X size={14} /></Button>
                            </li>))}
                    </ul>
                    <DialogFooter><Button variant="outline" onClick={() => setDeptOpen(false)}>Done</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
