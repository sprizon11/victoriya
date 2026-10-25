import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { ArrowLeft, FileCheck2, Download, AlertTriangle } from 'lucide-react';
import { PageHeader, Panel, StatCard, EmptyState, SkeletonRows, inr, num } from '../components/ui/primitives';

export default function LotClosurePage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [version, setVersion] = useState(null);
    const [cl, setCl] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get(`/lots/${id}/closure`, { params: version ? { version } : {} }).then(r => setCl(r.data))
            .catch(e => setError(e.response?.data?.detail || 'This lot has not been closed yet'));
    }, [id, version]);

    const exportAs = (fmt) => downloadFile(`/api/lots/${id}/closure/${fmt}${version ? `?version=${version}` : ''}`,
        `closing_${cl.lot_number.replace('/', '-')}_v${cl.version}.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`).catch(() => toast.error('Could not download'));

    if (error) return <EmptyState icon={FileCheck2} title="No closing report" message={error} action={<Button onClick={() => navigate('/lots')}>Back to lots</Button>} />;
    if (!cl) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><SkeletonRows rows={6} cols={4} /></div>;
    const q = cl.quantities;

    return (
        <div className="space-y-4" data-testid="closure-page">
            <PageHeader title={`Closing report · ${cl.lot_number}`} icon={FileCheck2}
                subtitle={`${cl.style_name} · closed ${cl.closed_at.slice(0, 10)} by ${cl.closed_by_name} · financial year ${cl.fy}`}
                actions={<>
                    <Button variant="ghost" onClick={() => navigate('/lots')} aria-label="Back to lots"><ArrowLeft size={16} /></Button>
                    {cl.versions.length > 1 && (
                        <select className="h-9 rounded-md border border-input bg-white px-2 text-[13px]" value={cl.version} aria-label="Report version"
                            onChange={e => setVersion(+e.target.value)} data-testid="closure-version">
                            {cl.versions.map(v => <option key={v} value={v}>Version {v}</option>)}</select>)}
                    <Button variant="outline" onClick={() => exportAs('excel')} data-testid="closure-excel"><Download size={14} /> Excel</Button>
                    <Button variant="outline" onClick={() => exportAs('pdf')} data-testid="closure-pdf"><Download size={14} /> PDF</Button>
                </>} />
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600"><strong>Reason:</strong> {cl.reason}. This report is a frozen snapshot: later edits to rates, names or stock do not change it.</p>
            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard i={0} label="Ordered" value={q.order} tone="slate" sub={q.allowance_pct ? `+${q.allowance_pct}% allowance` : 'no allowance'} />
                <StatCard i={1} label="Planned" value={q.planned} tone="brand" />
                <StatCard i={2} label="Finished" value={q.produced} tone="leaf" sub={`${q.progress}% of plan`} />
                <StatCard i={3} label="Short" value={Math.max(0, q.balance)} tone="amber" sub={cl.excess.length ? `${cl.excess.length} sizes over plan` : 'against plan'} />
            </div>
            {cl.acknowledged_warnings.length > 0 && (
                <Panel title="Open items acknowledged at closing">
                    <ul className="space-y-1 text-[12.5px] text-amber-800">{cl.acknowledged_warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>
                </Panel>
            )}
            <Panel title="Quantities by colour and size" bodyClass="p-0">
                <div className="overflow-x-auto"><table className="w-full text-[12.5px]">
                    <thead><tr className="border-b border-border bg-slate-50/90">{['Colour', 'Size', 'Ordered', 'Planned', 'Finished', 'Balance'].map((h, i) => (
                        <th key={h} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>))}</tr></thead>
                    <tbody>{q.by_color_size.map((r, i) => (
                        <tr key={i} className="border-b border-border/60"><td className="px-3 py-1.5">{r.color}</td><td className="px-3 py-1.5">{r.size}</td>
                            <td className="tnum px-3 py-1.5 text-right">{num(r.order)}</td><td className="tnum px-3 py-1.5 text-right">{num(r.planned)}</td>
                            <td className="tnum px-3 py-1.5 text-right">{num(r.produced)}</td>
                            <td className={`tnum px-3 py-1.5 text-right ${r.balance > 0 ? 'text-amber-700' : r.balance < 0 ? 'text-rose-600' : ''}`}>{num(r.balance)}</td></tr>))}</tbody>
                </table></div>
            </Panel>
            <Panel title="Cost at closing">
                <p className="tnum text-[13px]">Total <strong>{inr(cl.costing.total_cost)}</strong> · per finished piece <strong>{cl.costing.cost_per_piece.produced != null ? inr(cl.costing.cost_per_piece.produced) : '—'}</strong>
                    {cl.costing.margin && <> · profit <strong>{inr(cl.costing.margin.profit)}</strong> ({cl.costing.margin.profit_pct}%)</>}</p>
                <p className="mt-1 text-[12px] text-slate-500">Labour {inr(cl.costing.labour.total)} · materials {inr(cl.costing.materials.total)} · bills {inr(cl.costing.direct_expenses.total)} · overhead share {inr(cl.costing.overhead.total)}.
                    {cl.non_plan.pieces > 0 && ` Includes ${num(cl.non_plan.pieces)} sample/rework pieces costing ${inr(cl.non_plan.cost)}.`}</p>
            </Panel>
        </div>
    );
}
