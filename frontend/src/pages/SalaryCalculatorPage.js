import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { addDays, localDate, weekStartOf } from '../lib/utils';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Calculator, Save, Printer, ArrowRight, Sun, Moon } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, inr, FieldLabel } from '../components/ui/primitives';
import WeekPicker from '../components/WeekPicker';
import { Label } from '../components/ui/label';

const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const BLANK = () => Array(7).fill('');
const num = (v) => (v === '' || v == null ? 0 : parseFloat(v) || 0);
const shiftText = (v) => String(v).replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4);
const strs = (arr) => arr.map(x => (x ? String(x) : ''));
const sum = (arr) => arr.reduce((t, v) => t + num(v), 0);
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;       // display only; the server decides the saved figure

export default function SalaryCalculatorPage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const week = params.get('week') || weekStartOf(localDate());
    const workerParam = params.get('worker') || '';
    const [workers, setWorkers] = useState([]);
    const [depts, setDepts] = useState([]);
    const [dept, setDept] = useState('');
    const [saved, setSaved] = useState({});                   // worker_id -> entry for this week
    const [workerId, setWorkerId] = useState(workerParam);
    const [day, setDay] = useState(BLANK());
    const [night, setNight] = useState(BLANK());
    const [advance, setAdvance] = useState('');
    const [notes, setNotes] = useState('');
    const [reprice, setReprice] = useState(false);
    const [busy, setBusy] = useState(false);
    const [clean, setClean] = useState('');                   // JSON of what is saved, to know if there are unsaved edits
    const cells = useRef({});

    const worker = workers.find(w => w.id === workerId);
    const entry = saved[workerId];

    const loadWeek = useCallback(() => api.get(`/salary/week?start=${week}`).then(r => setSaved(Object.fromEntries(r.data.entries.map(e => [e.worker_id, e])))), [week]);
    useEffect(() => {
        Promise.all([api.get('/salary/workers?active=true'), api.get('/salary/departments')])
            .then(([w, d]) => { setWorkers(w.data); setDepts(d.data); }).catch(() => toast.error('Could not load workers'));
    }, []);
    useEffect(() => { loadWeek().catch(() => toast.error('Could not load this week')); }, [loadWeek]);

    // pick up what is already saved when the worker or the week changes
    useEffect(() => {
        const e = saved[workerId];
        if (e) {
            setDay(strs(e.day_shifts)); setNight(strs(e.night_shifts)); setAdvance(e.advance ? String(e.advance) : ''); setNotes(e.notes || '');
        } else { setDay(BLANK()); setNight(BLANK()); setAdvance(''); setNotes(''); }
        setReprice(false);
        setClean(JSON.stringify({ d: e ? strs(e.day_shifts) : BLANK(), n: e ? strs(e.night_shifts) : BLANK(), a: e?.advance ? String(e.advance) : '', t: e?.notes || '' }));
        // eslint-disable-next-line
    }, [workerId, week, saved]);

    const current = JSON.stringify({ d: day, n: night, a: advance, t: notes });
    const dirty = !!workerId && current !== clean;

    const setWeek = (w) => {
        if (dirty && !window.confirm('You have unsaved changes for this worker. Change the week anyway?')) return;
        const next = new URLSearchParams(params); next.set('week', w); setParams(next, { replace: true });
    };
    const pick = (id) => {
        if (dirty && !window.confirm('You have unsaved changes for this worker. Switch anyway?')) return;
        setWorkerId(id);
        const next = new URLSearchParams(params); if (id) next.set('worker', id); else next.delete('worker'); setParams(next, { replace: true });
    };

    // rates in force: the ones the week was paid at, unless the user asks for today's
    const useSaved = entry && !reprice;
    const dayRate = useSaved ? entry.day_rate : worker?.day_rate || 0;
    const nightRate = useSaved ? entry.night_rate : worker?.night_rate || 0;
    const rateChanged = entry && worker && (entry.day_rate !== worker.day_rate || entry.night_rate !== worker.night_rate);

    const dayTotal = sum(day), nightTotal = sum(night);
    const dayWage = r2(dayTotal * dayRate), nightWage = r2(nightTotal * nightRate);
    const gross = r2(dayWage + nightWage);
    const adv = num(advance);
    const net = r2(gross - adv);
    const tooMuch = adv > gross + 0.001;
    const badCell = [...day, ...night].some(v => v !== '' && (num(v) * 2) % 1 !== 0);

    const dates = useMemo(() => DAYS.map((d, i) => { const iso = addDays(week, i); return { d, n: iso.slice(8) }; }), [week]);

    const move = (e, row, col, dRow, dCol) => {
        const el = cells.current[`${row + dRow}:${col + dCol}`];
        if (el) { e.preventDefault(); el.focus(); el.select(); }
    };
    const onKey = (e, row, col) => {
        const { selectionStart: a, selectionEnd: b, value } = e.target;
        if (e.key === 'Enter' || e.key === 'ArrowDown') move(e, row, col, row === 1 ? 0 : 1, 0);
        else if (e.key === 'ArrowUp') move(e, row, col, -1, 0);
        else if (e.key === 'ArrowRight' && a === value.length && b === value.length) move(e, row, col, 0, 1);
        else if (e.key === 'ArrowLeft' && a === 0 && b === 0) move(e, row, col, 0, -1);
    };
    const setCell = (arr, setArr, i, v) => setArr(arr.map((x, j) => (j === i ? shiftText(v) : x)));

    const body = () => ({ day_shifts: day.map(num), night_shifts: night.map(num), advance: adv, notes, reprice });
    const save = async () => {
        if (!worker) return toast.error('Choose a worker');
        if (badCell) return toast.error('Shifts go up in halves: 0, 0.5, 1, 1.5 …');
        if (tooMuch) return toast.error('The advance is more than the wage');
        setBusy(true);
        try {
            await api.put(`/salary/week/${week}/worker/${workerId}`, body());
            toast.success(`${worker.name} saved for this week`);
            await loadWeek();
            return true;
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 8000 }); return false; }
        finally { setBusy(false); }
    };
    const saveNext = async () => {
        if (!(await save())) return;
        const list = visible;
        const i = list.findIndex(w => w.id === workerId);
        const nextWorker = list.slice(i + 1).find(w => !saved[w.id]) || list.find(w => w.id !== workerId && !saved[w.id]);
        if (nextWorker) { setWorkerId(nextWorker.id); const n = new URLSearchParams(params); n.set('worker', nextWorker.id); setParams(n, { replace: true }); }
        else toast.message('Everyone listed has been saved for this week.');
    };
    const print = async () => {
        try {
            const res = await fetch(`${api.defaults.baseURL}/salary/payslip/${week}/${workerId}`, { credentials: 'include' });
            if (!res.ok) throw new Error();
            window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
        } catch { toast.error('Could not open the payslip'); }
    };
    const fill = (setArr, v) => setArr(Array(7).fill(v));

    const visible = workers.filter(w => !dept || w.department === dept);
    const done = Object.keys(saved).length;

    return (
        <div className="space-y-4" data-testid="salary-calc-page">
            <PageHeader title="Salary calculator" icon={Calculator} subtitle="Enter each worker's day and night shifts for the week, check the payslip, then save it."
                actions={<Button variant="outline" onClick={() => navigate(`/salary/week?week=${week}`)} data-testid="go-week">This week ({done} saved)</Button>} />
            <WeekPicker value={week} onChange={setWeek} />

            {workers.length === 0 ? (
                <Panel bodyClass="p-0"><EmptyState icon={Calculator} title="Add your workers first" message="Salary needs a worker list with day and night rates."
                    action={<Button onClick={() => navigate('/salary/workers')}>Go to Workers</Button>} /></Panel>
            ) : (
                <div className="grid gap-4 lg:grid-cols-5">
                    <div className="min-w-0 space-y-4 lg:col-span-3">
                        <Panel title="Worker" bodyClass="p-3.5">
                            <div className="grid gap-3 sm:grid-cols-3">
                                {depts.length > 0 && (
                                    <div><Label><FieldLabel>Department</FieldLabel></Label>
                                        <select className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]" value={dept} onChange={e => setDept(e.target.value)} aria-label="Department" data-testid="calc-dept">
                                            <option value="">All departments</option>{depts.map(d => <option key={d.id} value={d.name}>{d.name} ({d.workers})</option>)}</select></div>)}
                                <div className={depts.length > 0 ? 'sm:col-span-2' : 'sm:col-span-3'}><Label><FieldLabel required>Worker</FieldLabel></Label>
                                    <select className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]" value={workerId} onChange={e => pick(e.target.value)} aria-label="Worker" data-testid="calc-worker">
                                        <option value="">Choose a worker…</option>
                                        {visible.map(w => <option key={w.id} value={w.id}>{saved[w.id] ? '✓ ' : ''}{w.name}{w.designation ? ` · ${w.designation}` : ''}</option>)}</select></div>
                            </div>
                            {worker && (
                                <p className="mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-[12px] text-slate-600 ring-1 ring-inset ring-slate-200" data-testid="calc-chip">
                                    {worker.designation || 'Worker'}{worker.department && ` · ${worker.department}`} · Day {inr(worker.day_rate, { decimals: 0 })}/shift · Night {inr(worker.night_rate, { decimals: 0 })}/shift
                                </p>)}
                        </Panel>

                        <Panel title="Shifts this week (Sat to Fri)" bodyClass="p-3.5">
                            <div className="overflow-x-auto">
                                <table className="w-full table-fixed text-center sm:min-w-[520px]" data-testid="shift-grid">
                                    <thead><tr>
                                        <th className="w-9 pb-1 text-left sm:w-24 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" />
                                        {dates.map(x => <th key={x.d} className="pb-1 text-[11px] font-semibold text-slate-500">{x.d}<span className="block text-[10px] font-normal text-slate-400">{x.n}</span></th>)}
                                        <th className="w-9 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-auto">Total</th></tr></thead>
                                    <tbody>
                                        {[['Day shift', Sun, day, setDay, 0], ['Night shift', Moon, night, setNight, 1]].map(([label, Icon, arr, setArr, row]) => (
                                            <tr key={label}>
                                                <td className="py-1 pr-1 text-left text-[12.5px] font-medium text-slate-700 sm:pr-2" title={label}><span className="inline-flex items-center gap-1.5"><Icon size={14} className={row ? 'text-indigo-500' : 'text-amber-500'} /><span className="hidden sm:inline">{label}</span></span></td>
                                                {arr.map((v, i) => (
                                                    <td key={i} className="px-0.5 py-1">
                                                        <input type="text" inputMode="decimal" autoComplete="off" value={v} placeholder="0" disabled={!workerId}
                                                            ref={el => { cells.current[`${row}:${i}`] = el; }} onFocus={e => e.target.select()}
                                                            onChange={e => setCell(arr, setArr, i, e.target.value)} onKeyDown={e => onKey(e, row, i)}
                                                            aria-label={`${label}, ${DAYS[i]}`} data-testid={`${row ? 'night' : 'day'}-${i}`}
                                                            className={`h-11 w-full min-w-0 rounded-lg px-0 border bg-white text-center text-[15px] font-medium tabular-nums outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-300
                                                                ${v !== '' && (num(v) * 2) % 1 !== 0 ? 'border-rose-400 bg-rose-50' : 'border-input'}`} />
                                                    </td>))}
                                                <td className="tnum px-1 text-[13px] sm:px-2 sm:text-[14px] font-semibold text-slate-800" data-testid={`${row ? 'night' : 'day'}-total`}>{sum(arr)}</td>
                                            </tr>))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500">
                                <span>1 = a full shift · 1.5 = shift plus overtime · 0.5 = half · 0 = absent</span>
                                <span className="ml-auto flex gap-1.5">
                                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!workerId} onClick={() => fill(setDay, '1')} data-testid="fill-day">Day: all 1</Button>
                                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!workerId} onClick={() => fill(setNight, '1')} data-testid="fill-night">Night: all 1</Button>
                                    <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!workerId} onClick={() => { setDay(BLANK()); setNight(BLANK()); }}>Clear</Button>
                                </span>
                            </div>
                        </Panel>

                        <Panel title="Advance this week" bodyClass="p-3.5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div><Label><FieldLabel>Amount taken (₹)</FieldLabel></Label>
                                    <Input className="mt-1 font-mono" inputMode="decimal" placeholder="0" disabled={!workerId} value={advance}
                                        onChange={e => setAdvance(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} aria-label="Advance amount" data-testid="calc-advance" /></div>
                                <div><Label><FieldLabel>Note (optional)</FieldLabel></Label>
                                    <Input className="mt-1" disabled={!workerId} value={notes} maxLength={200} onChange={e => setNotes(e.target.value)} placeholder="e.g. festival advance" aria-label="Advance note" data-testid="calc-notes" /></div>
                            </div>
                            {tooMuch && <p className="mt-2 text-[12px] text-rose-600" role="alert">The advance is more than this week's wage. Take less now; the rest can come next week.</p>}
                        </Panel>
                    </div>

                    <div className="min-w-0 lg:col-span-2">
                        <Panel title="Payslip" bodyClass="p-4" data-testid="payslip">
                            {!worker ? <p className="py-8 text-center text-[13px] text-slate-400">Choose a worker to see the payslip.</p> : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-3">
                                        <span className="grid h-11 w-11 place-items-center rounded-full bg-brand/10 text-[14px] font-bold text-brand">{worker.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                                        <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-slate-900" data-testid="slip-name">{worker.name}</p>
                                            <p className="text-[12px] text-slate-500">{worker.designation || 'Worker'} · {dayTotal + nightTotal === 0 ? '0 shifts' : `${dayTotal + nightTotal} shifts`}</p></div>
                                        {entry && !dirty && <Pill tone="green" className="ml-auto">saved</Pill>}
                                        {dirty && <Pill tone="amber" className="ml-auto">unsaved</Pill>}
                                    </div>
                                    {rateChanged && (
                                        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
                                            <input type="checkbox" className="mt-0.5" checked={reprice} onChange={e => setReprice(e.target.checked)} data-testid="reprice" />
                                            <span>This week was paid at day ₹{entry.day_rate} / night ₹{entry.night_rate}. Today's rates are day ₹{worker.day_rate} / night ₹{worker.night_rate}. Tick to use today's rates.</span></label>)}
                                    <dl className="divide-y divide-dashed divide-border text-[13px]">
                                        <div className="flex justify-between py-2"><dt className="text-slate-600">Day shifts ({dayTotal} × ₹{dayRate})</dt><dd className="tnum font-medium" data-testid="slip-day">{inr(dayWage, { decimals: 0 })}</dd></div>
                                        <div className="flex justify-between py-2"><dt className="text-slate-600">Night shifts ({nightTotal} × ₹{nightRate})</dt><dd className="tnum font-medium" data-testid="slip-night">{inr(nightWage, { decimals: 0 })}</dd></div>
                                        <div className="flex justify-between py-2"><dt className="font-medium text-slate-700">Gross</dt><dd className="tnum font-semibold" data-testid="slip-gross">{inr(gross, { decimals: 0 })}</dd></div>
                                        <div className="flex justify-between py-2"><dt className="text-slate-600">Advance</dt><dd className="tnum font-medium text-rose-600" data-testid="slip-advance">− {inr(adv, { decimals: 0 })}</dd></div>
                                    </dl>
                                    <div className={`flex items-center justify-between rounded-xl px-4 py-4 ${net < 0 ? 'bg-rose-50' : 'bg-brand/5'}`}>
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Net pay</span>
                                        <span className="tnum font-outfit text-[30px] font-semibold text-brand" data-testid="slip-net">{inr(net, { decimals: 0 })}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button className="flex-1" loading={busy} disabled={!workerId || tooMuch || badCell} onClick={save} data-testid="calc-save"><Save size={14} /> Save to week</Button>
                                        <Button variant="outline" disabled={!entry || dirty} onClick={print} title={dirty ? 'Save first' : 'Open the payslip'} data-testid="calc-print"><Printer size={14} /> Print</Button>
                                    </div>
                                    <Button variant="ghost" className="w-full text-[12.5px]" disabled={!workerId || busy || tooMuch || badCell} onClick={saveNext} data-testid="calc-save-next">Save and go to the next unsaved worker <ArrowRight size={13} /></Button>
                                </div>
                            )}
                        </Panel>
                    </div>
                </div>
            )}
        </div>
    );
}
