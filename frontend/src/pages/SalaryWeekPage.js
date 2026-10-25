import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { downloadFile, BACKEND_URL } from '../lib/api';
import { addDays, localDate, weekStartOf } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { CalendarDays, Download, Printer, Pencil, Trash2, Eraser, Plus } from 'lucide-react';
import { PageHeader, Panel, StatCard, EmptyState, inr } from '../components/ui/primitives';
import WeekPicker from '../components/WeekPicker';

const money = (n) => inr(n, { decimals: 0 });

async function openPdf(path) {
    const res = await fetch(`${BACKEND_URL}/api${path}`, { credentials: 'include' });
    if (!res.ok) throw new Error();
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
}

export default function SalaryWeekPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const week = params.get('week') || weekStartOf(localDate());
    const [data, setData] = useState(null);
    const [clearOpen, setClearOpen] = useState(false);
    const [typed, setTyped] = useState('');

    const load = useCallback(() => api.get(`/salary/week?start=${week}`).then(r => setData(r.data)).catch(() => toast.error('Could not load the week')), [week]);
    useEffect(() => { setData(null); load(); }, [load]);

    const setWeek = (w) => setParams({ week: w }, { replace: true });
    const entries = data?.entries || [];
    const t = data?.totals;

    const remove = async (e) => {
        if (!window.confirm(`Remove ${e.worker_name} from this week? Their shifts and advance for the week will be deleted.`)) return;
        try { await api.delete(`/salary/week/${week}/worker/${e.worker_id}`); toast.success('Removed'); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not remove'); }
    };
    const clearWeek = async () => {
        try { await api.post(`/salary/week/${week}/clear`, { confirm: typed.trim() }); toast.success('Week cleared'); setClearOpen(false); setTyped(''); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not clear the week'); }
    };

    return (
        <div className="space-y-4" data-testid="salary-week-page">
            <PageHeader title="This week" icon={CalendarDays} subtitle="Everything saved for the chosen pay week."
                actions={<>
                    <Button variant="outline" size="sm" disabled={!entries.length} onClick={() => openPdf(`/salary/payslips/${week}`).catch(() => toast.error('Could not open payslips'))} data-testid="print-all"><Printer size={14} /> Print payslips</Button>
                    <Button variant="outline" size="sm" disabled={!entries.length} onClick={() => downloadFile(`/api/salary/export?week=${week}`, `salary_${week}.xlsx`).catch(() => toast.error('Export failed'))} data-testid="export-week"><Download size={14} /> Export week to Excel</Button>
                    {user?.role === 'admin' && <Button variant="outline" size="sm" disabled={!entries.length} className="text-rose-600" onClick={() => setClearOpen(true)} data-testid="clear-week"><Eraser size={14} /> Clear week</Button>}
                </>} />
            <WeekPicker value={week} onChange={setWeek} />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Workers paid" value={t?.workers ?? 0} loading={!data} icon={CalendarDays} i={0} />
                <StatCard label="Gross wages" value={t?.gross ?? 0} format={money} loading={!data} tone="brand" i={1} sub={t ? `${t.day_shifts} day · ${t.night_shifts} night shifts` : ''} />
                <StatCard label="Advances recovered" value={t?.advance ?? 0} format={money} loading={!data} tone="amber" i={2} />
                <StatCard label="Net to pay" value={t?.net ?? 0} format={money} loading={!data} tone="leaf" i={3} />
            </div>

            <Panel bodyClass="p-0" title="Saved for this week" actions={<Button size="sm" onClick={() => navigate(`/salary?week=${week}`)} data-testid="add-entry"><Plus size={14} /> Add / edit a worker</Button>}>
                {!data ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="skeleton h-9" />)}</div>
                    : entries.length === 0 ? <EmptyState icon={CalendarDays} title="Nothing saved for this week yet" message="Use the calculator to enter each worker's shifts."
                        action={<Button onClick={() => navigate(`/salary?week=${week}`)}>Open the calculator</Button>} />
                        : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[780px] text-[13px]" data-testid="week-table">
                                    <thead><tr className="border-b border-border bg-slate-50/70 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <th className="px-4 py-2">Worker</th><th className="px-2 py-2 text-right">Day</th><th className="px-2 py-2 text-right">Night</th>
                                        <th className="px-2 py-2 text-right">Gross</th><th className="px-2 py-2 text-right">Advance</th><th className="px-2 py-2 text-right">Net pay</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
                                    <tbody>
                                        {entries.map(e => (
                                            <tr key={e.id || e.worker_id} className="border-b border-border/60 last:border-0 hover:bg-slate-50/60" data-testid="week-row">
                                                <td className="px-4 py-2"><p className="font-medium text-slate-800">{e.worker_name}</p>
                                                    <p className="text-[11px] text-slate-400">{[e.designation, e.department].filter(Boolean).join(' · ') || '—'}</p></td>
                                                <td className="tnum px-2 py-2 text-right">{e.day_total}<span className="block text-[10.5px] text-slate-400">× {e.day_rate}</span></td>
                                                <td className="tnum px-2 py-2 text-right">{e.night_total}<span className="block text-[10.5px] text-slate-400">× {e.night_rate}</span></td>
                                                <td className="tnum px-2 py-2 text-right">{money(e.gross)}</td>
                                                <td className="tnum px-2 py-2 text-right text-rose-600">{e.advance ? `− ${money(e.advance)}` : '—'}</td>
                                                <td className="tnum px-2 py-2 text-right font-semibold text-brand">{money(e.net)}</td>
                                                <td className="whitespace-nowrap px-3 py-2 text-right">
                                                    <Button variant="ghost" size="sm" aria-label={`Edit ${e.worker_name}`} onClick={() => navigate(`/salary?week=${week}&worker=${e.worker_id}`)}><Pencil size={14} /></Button>
                                                    <Button variant="ghost" size="sm" aria-label={`Print payslip for ${e.worker_name}`} onClick={() => openPdf(`/salary/payslip/${week}/${e.worker_id}`).catch(() => toast.error('Could not open the payslip'))}><Printer size={14} /></Button>
                                                    <Button variant="ghost" size="sm" className="text-rose-600" aria-label={`Remove ${e.worker_name}`} onClick={() => remove(e)}><Trash2 size={14} /></Button>
                                                </td>
                                            </tr>))}
                                    </tbody>
                                    <tfoot><tr className="border-t-2 border-border bg-slate-50/70 font-semibold">
                                        <td className="px-4 py-2">Total ({t.workers})</td><td className="tnum px-2 py-2 text-right">{t.day_shifts}</td><td className="tnum px-2 py-2 text-right">{t.night_shifts}</td>
                                        <td className="tnum px-2 py-2 text-right">{money(t.gross)}</td><td className="tnum px-2 py-2 text-right text-rose-600">− {money(t.advance)}</td><td className="tnum px-2 py-2 text-right text-brand">{money(t.net)}</td><td /></tr></tfoot>
                                </table>
                            </div>)}
            </Panel>
            <p className="text-[11.5px] text-slate-400">History across weeks is under <Link to="/salary/history" className="text-brand underline-offset-2 hover:underline">History</Link>. Previous week: <button className="text-brand underline-offset-2 hover:underline" onClick={() => setWeek(addDays(week, -7))}>open it</button>.</p>

            <Dialog open={clearOpen} onOpenChange={(o) => { setClearOpen(o); if (!o) setTyped(''); }}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Clear the whole week?</DialogTitle></DialogHeader>
                    <p className="text-[13px] text-slate-600">This removes all {entries.length} saved workers for the week starting <b>{week}</b>. A copy is kept in the system, but it will not show here. Type the start date to confirm.</p>
                    <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder={week} aria-label="Type the week's start date" data-testid="clear-confirm" />
                    <DialogFooter><Button variant="outline" onClick={() => setClearOpen(false)}>Cancel</Button>
                        <Button className="bg-rose-600 hover:bg-rose-700" disabled={typed.trim() !== week} onClick={clearWeek} data-testid="clear-go">Clear week</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
