import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { ArrowLeft, CalendarCheck } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, SkeletonRows, num } from '../components/ui/primitives';

const OUTCOME = { carried: ['green', 'Carried forward'], already_carried: ['slate', 'Already carried'], closed: ['green', 'Closed'],
    already_closed: ['slate', 'Already closed'], skipped: ['slate', 'Left open'], error: ['rose', 'Not done'] };

export default function YearEndPage() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [choice, setChoice] = useState({});
    const [reason, setReason] = useState('Financial year end');
    const [results, setResults] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = () => api.get('/year-end').then(r => {
        setData(r.data);
        setChoice(Object.fromEntries(r.data.lots.map(l => [l.id, l.already_carried_to ? 'skip' : (l.balance > 0 ? 'carry' : 'close')])));
    }).catch(() => toast.error('Could not load the year-end list'));
    useEffect(() => { load(); }, []);

    const apply = async () => {
        const actions = Object.entries(choice).map(([lot_id, action]) => ({ lot_id, action, reason }));
        if (!window.confirm(`Apply these ${actions.filter(a => a.action !== 'skip').length} changes? Closing saves a closing report; carrying forward creates a new lot for what is left.`)) return;
        setBusy(true);
        try { const r = await api.post('/year-end', { actions }); setResults(r.data.results); toast.success(`${r.data.processed} lots processed`); await load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not apply', { duration: 8000 }); }
        finally { setBusy(false); }
    };

    return (
        <div className="space-y-4" data-testid="year-end-page">
            <PageHeader title="Financial-year rollover" icon={CalendarCheck}
                subtitle={data ? `Lots from earlier years that are still open (this is ${data.current_fy}). Nothing happens until you press Apply.` : 'Loading…'}
                actions={<Button variant="ghost" onClick={() => navigate('/lots')} aria-label="Back to lots"><ArrowLeft size={16} /></Button>} />
            {!data ? <SkeletonRows rows={4} cols={5} /> : data.lots.length === 0 && !results ? (
                <EmptyState icon={CalendarCheck} title="All caught up" message="No lots are open from an earlier financial year." action={<Button onClick={() => navigate('/lots')}>Back to lots</Button>} />
            ) : (<>
                {data.lots.length > 0 && (
                    <Panel bodyClass="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead><tr className="border-b border-border bg-slate-50/90">
                                    {['Lot', 'Style', 'Year', 'Done', 'Left', 'What to do'].map((h, i) => <th key={h} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                                </tr></thead>
                                <tbody>{data.lots.map(l => (
                                    <tr key={l.id} className="border-b border-border/60" data-testid={`ye-row-${l.id}`}>
                                        <td className="px-3 py-2 font-mono text-[12px] font-semibold text-brand">{l.lot_number}</td>
                                        <td className="px-3 py-2">{l.style_name}</td><td className="px-3 py-2 text-slate-500">{l.fy}</td>
                                        <td className="tnum px-3 py-2">{l.progress}%</td><td className="tnum px-3 py-2 text-right">{num(l.balance)} pcs</td>
                                        <td className="px-3 py-2">
                                            <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={choice[l.id] || 'skip'}
                                                aria-label={`Action for ${l.lot_number}`} data-testid={`ye-choice-${l.id}`}
                                                onChange={e => setChoice({ ...choice, [l.id]: e.target.value })}>
                                                <option value="carry" disabled={l.balance <= 0}>Carry the {num(l.balance)} left into this year</option>
                                                <option value="close">Close it as it is</option>
                                                <option value="skip">Leave open for now</option>
                                            </select>
                                            {l.already_carried_to && <span className="ml-2 text-[11px] text-slate-400">already carried to {l.already_carried_to}</span>}
                                        </td>
                                    </tr>))}</tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-end gap-3 border-t border-border px-3 py-3">
                            <label className="text-[11.5px] font-medium text-slate-500">Reason recorded on the closing reports
                                <input className="mt-1 block h-9 w-72 rounded-md border border-input bg-white px-2 text-[13px]" value={reason} onChange={e => setReason(e.target.value)} data-testid="ye-reason" /></label>
                            <Button loading={busy} onClick={apply} data-testid="ye-apply">Apply</Button>
                            <p className="text-[11.5px] text-slate-400">Material still on a carried lot moves to the new lot with it. A lot cannot be closed while a request about it is waiting for approval.</p>
                        </div>
                    </Panel>
                )}
                {results && (
                    <Panel title="What happened" bodyClass="p-0" data-testid="ye-results">
                        <ul className="divide-y divide-border text-[13px]">{results.map((r, i) => {
                            const [tone, label] = OUTCOME[r.status] || ['slate', r.status];
                            return (<li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                <span className="font-mono text-[12px] font-semibold text-brand">{r.lot_number}</span><Pill tone={tone}>{label}</Pill>
                                {r.new_lot && <span className="text-slate-600">→ <Link className="text-brand hover:underline" to="/lots">{r.new_lot}</Link>{r.pieces ? ` (${num(r.pieces)} pcs)` : ''}</span>}
                                {r.materials_moved?.length > 0 && <span className="text-[11.5px] text-slate-400">moved: {r.materials_moved.join(', ')}</span>}
                                {r.error && <span className="text-[12px] text-rose-600">{r.error}</span>}
                            </li>);
                        })}</ul>
                    </Panel>
                )}
            </>)}
        </div>
    );
}
