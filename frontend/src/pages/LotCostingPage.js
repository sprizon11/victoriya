import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { ArrowLeft, Calculator, Download } from 'lucide-react';
import { PageHeader, Panel, StatCard, EmptyState, SkeletonRows, inr, num } from '../components/ui/primitives';

const inr0 = (n) => inr(n, { decimals: 0 });
const Table = ({ headers, rows, right = [] }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-border bg-slate-50/90">
                {headers.map((h, i) => <th key={h} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${right.includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={headers.length} className="px-3 py-5 text-center text-slate-400">Nothing recorded</td></tr>
                : rows.map((r, i) => <tr key={i} className="border-b border-border/60">{r.map((c, j) => <td key={j} className={`px-3 py-1.5 ${right.includes(j) ? 'tnum text-right' : ''}`}>{c}</td>)}</tr>)}</tbody>
        </table>
    </div>
);

export default function LotCostingPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [c, setC] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get(`/reports/lot-costing/${id}`).then(r => setC(r.data)).catch(e => setError(e.response?.data?.detail || 'Could not load the costing report'));
    }, [id]);

    const exportAs = (fmt) => downloadFile(`/api/reports/lot-costing/${id}/${fmt}`, `costing_${c.lot_number.replace('/', '-')}.${fmt === 'pdf' ? 'pdf' : 'xlsx'}`)
        .catch(() => toast.error('Could not download'));

    if (error) return <EmptyState icon={Calculator} title="Costing unavailable" message={error} />;
    if (!c) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><SkeletonRows rows={6} cols={4} /></div>;
    const per = c.cost_per_piece;

    return (
        <div className="space-y-4" data-testid="costing-page">
            <PageHeader title={`Costing · ${c.lot_number}`} icon={Calculator} subtitle={`${c.style_name} · ${c.status === 'completed' ? 'closed' : 'in production'}`}
                actions={<>
                    <Button variant="ghost" onClick={() => navigate('/lots')} aria-label="Back to lots"><ArrowLeft size={16} /></Button>
                    <Button variant="outline" onClick={() => exportAs('excel')} data-testid="costing-excel"><Download size={14} /> Excel</Button>
                    <Button variant="outline" onClick={() => exportAs('pdf')} data-testid="costing-pdf"><Download size={14} /> PDF</Button>
                </>} />
            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard i={0} label="Total cost" value={c.total_cost} format={inr0} tone="brand" sub={`${num(c.quantities.produced)} pieces finished`} />
                <StatCard i={1} label="Cost per finished piece" value={per.produced || 0} format={(n) => inr(n)} tone="leaf" sub={per.produced ? `${inr(per.planned)} per planned piece` : 'nothing finished yet'} />
                <StatCard i={2} label="Labour" value={c.labour.total} format={inr0} tone="amber" sub={c.labour.non_plan_qty ? `incl. ${num(c.labour.non_plan_qty)} sample/rework pcs` : 'piece-rate pay'} />
                {c.margin ? <StatCard i={3} label="Profit" value={c.margin.profit} format={inr0} tone={c.margin.profit >= 0 ? 'leaf' : 'slate'} sub={`${c.margin.profit_pct}% of ${inr0(c.margin.revenue)} revenue`} />
                    : <StatCard i={3} label="Materials" value={c.materials.total} format={inr0} tone="slate" sub="valued when issued" />}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Where the money went" bodyClass="p-0">
                    <Table headers={['Component', 'Amount', 'Share']} right={[1, 2]}
                        rows={c.breakdown.map(b => [b.component, inr(b.amount), c.total_cost ? `${Math.round(b.amount / c.total_cost * 100)}%` : '—'])} />
                </Panel>
                <Panel title="Planned vs actual labour" subtitle="Regular-rate pay against every planned piece through each operation" bodyClass="p-0">
                    <Table headers={['Operation', 'Planned', 'Actual', 'Difference']} right={[1, 2, 3]}
                        rows={c.labour_variance.map(v => [v.operation, inr(v.planned_cost), inr(v.actual_cost),
                            <span key="v" className={v.variance > 0 ? 'text-rose-600' : 'text-emerald-700'}>{v.variance > 0 ? '+' : ''}{inr(v.variance)}{v.variance_pct != null ? ` (${v.variance_pct}%)` : ''}</span>])} />
                </Panel>
            </div>
            <Panel title="Labour" subtitle="By operation group, operation and rate type" bodyClass="p-0">
                <Table headers={['Group', 'Operation', 'Paid as', 'Pieces', 'Cost']} right={[3, 4]}
                    rows={c.labour.rows.map(r => [r.group || '—', r.operation, r.rate_type, num(r.qty), inr(r.cost)])} />
            </Panel>
            <Panel title="Materials" subtitle="Issued less returned and moved out, valued at average cost when they moved" bodyClass="p-0">
                <Table headers={['Item', 'Issued', 'Returned', 'Wasted', 'Moved in', 'Moved out', 'Cost']} right={[1, 2, 3, 4, 5, 6]}
                    rows={c.materials.rows.map(m => [m.item, `${num(m.issued)} ${m.uom}`, num(m.returned), num(m.wasted), num(m.moved_in), num(m.moved_out), inr(m.value)])} />
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Bills charged to this lot" bodyClass="p-0">
                    <Table headers={['Category', 'Total']} right={[1]} rows={c.direct_expenses.rows.map(r => [r.category, inr(r.total)])} />
                </Panel>
                <Panel title="Share of general overhead" subtitle={c.overhead.rule} bodyClass="p-0">
                    <Table headers={['Month', 'Pool', 'This lot', 'All lots', 'Share']} right={[1, 2, 3, 4]}
                        rows={c.overhead.detail.map(d => [d.month, inr(d.pool), `${num(d.lot_pieces)} pcs`, `${num(d.all_pieces)} pcs`, inr(d.share)])} />
                </Panel>
            </div>
        </div>
    );
}
