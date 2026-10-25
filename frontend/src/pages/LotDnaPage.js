import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { ArrowLeft, Fingerprint, Printer, Tag, Factory, PackageCheck, Layers, Receipt, FileText, Lock, ShieldCheck, Pencil } from 'lucide-react';
import { PageHeader, Panel, StatCard, EmptyState, Pill, SkeletonRows, num, inr } from '../components/ui/primitives';

const KIND = {
    lot: [Layers, 'text-brand bg-brand/10'], lineage: [Layers, 'text-violet-600 bg-violet-50'], change: [Pencil, 'text-slate-600 bg-slate-100'],
    approval: [ShieldCheck, 'text-amber-700 bg-amber-50'], production: [Factory, 'text-leaf bg-leaf/10'], material: [PackageCheck, 'text-sky-700 bg-sky-50'],
    expense: [Receipt, 'text-rose-600 bg-rose-50'], purchase: [FileText, 'text-indigo-600 bg-indigo-50'], closure: [Lock, 'text-emerald-700 bg-emerald-50'],
};
const FILTERS = [['all', 'Everything'], ['production', 'Production'], ['material', 'Material'], ['approval', 'Approvals'], ['change', 'Changes'], ['money', 'Money']];

export default function LotDnaPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('timeline');
    const [filter, setFilter] = useState('all');

    useEffect(() => { api.get(`/lots/${id}/dna`).then(r => setD(r.data)).catch(e => setError(e.response?.data?.detail || 'Could not load this lot')); }, [id]);

    const events = useMemo(() => {
        if (!d) return [];
        const keep = { all: () => true, production: e => e.kind === 'production', material: e => e.kind === 'material', approval: e => e.kind === 'approval',
            change: e => ['change', 'lot', 'lineage', 'closure'].includes(e.kind), money: e => ['expense', 'purchase'].includes(e.kind) }[filter];
        return d.timeline.filter(keep);
    }, [d, filter]);

    const open = (path, name) => downloadFile(`/api/lots/${id}/dna/${path}`, name).catch(() => toast.error('Could not download'));

    if (error) return <EmptyState icon={Fingerprint} title="Lot DNA unavailable" message={error} action={<Button onClick={() => navigate('/lots')}>Back to lots</Button>} />;
    if (!d) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><SkeletonRows rows={6} cols={3} /></div>;
    const h = d.header;
    const chain = [...d.lineage.filter(l => l.relation === 'earlier'), d.lineage_current, ...d.lineage.filter(l => l.relation === 'later')];

    return (
        <div className="space-y-4" data-testid="dna-page">
            <PageHeader title={`Lot DNA · ${h.lot_number}`} icon={Fingerprint} subtitle={`${h.style_name} · financial year ${h.fy} · ${h.status === 'completed' ? 'closed' : 'in production'}`}
                actions={<>
                    <Button variant="ghost" onClick={() => navigate('/lots')} aria-label="Back to lots"><ArrowLeft size={16} /></Button>
                    <Button variant="outline" onClick={() => open('sheet', `DNA_${h.lot_number.replace('/', '-')}.pdf`)} data-testid="dna-sheet"><Printer size={14} /> Sheet (A4)</Button>
                    <Button variant="outline" onClick={() => open('tag', `tag_${h.lot_number.replace('/', '-')}.pdf`)} data-testid="dna-tag"><Tag size={14} /> Carton tag</Button>
                </>} />

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">DNA code</p>
                    <p className="font-mono text-[18px] font-semibold tracking-wider text-brand" data-testid="dna-code">{h.dna_code}</p>
                </div>
                {h.integrity && <div className="border-l border-border pl-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Closing report v{h.closure_version} fingerprint</p>
                    <p className="font-mono text-[13px] text-slate-700" data-testid="dna-integrity">{h.integrity}</p></div>}
                <p className="ml-auto max-w-sm text-[11.5px] text-slate-400">Printed on the sheet and carton tag with a QR code. The code is worked out from this lot by the server, so it cannot be invented.</p>
            </div>

            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard i={0} label="Ordered" value={h.ordered} tone="slate" />
                <StatCard i={1} label="Planned" value={h.planned} tone="brand" />
                <StatCard i={2} label="Finished" value={h.produced} tone="leaf" sub={`${h.progress}% of plan`} />
                {h.cost_per_piece != null ? <StatCard i={3} label="Cost per finished piece" value={h.cost_per_piece} format={(n) => inr(n)} tone="amber" /> : <StatCard i={3} label="Due" value={0} format={() => h.target_end_date || '—'} tone="amber" />}
            </div>

            {d.lineage.length > 0 && (
                <Panel title="Lineage" subtitle="Unfinished pieces carry forward into the next financial year's lot" bodyClass="p-3" data-testid="dna-lineage">
                    <ol className="flex flex-wrap items-center gap-2">{chain.map((l, i) => (
                        <li key={l.id} className="flex items-center gap-2">{i > 0 && <span className="text-slate-300" aria-hidden="true">→</span>}
                            {l.relation === 'this' ? <Pill tone="brand">{l.lot_number} · this lot</Pill> : <Link to={`/lots/${l.id}/dna`} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-200">{l.lot_number} <span className="text-slate-400">FY {l.fy}</span></Link>}</li>))}</ol>
                </Panel>
            )}

            <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-0.5" role="tablist">{[['timeline', 'Timeline'], ['materials', 'Materials'], ['people', 'People']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`dna-tab-${k}`}
                    className={`press cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium ${tab === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{label}</button>))}</div>

            {tab === 'timeline' && (
                <Panel bodyClass="p-3">
                    <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter the timeline">{FILTERS.map(([k, label]) => (
                        <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
                            className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${filter === k ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>))}</div>
                    <ol className="relative space-y-3 border-l border-border pl-5" data-testid="dna-timeline">
                        {events.map((e, i) => {
                            const [Icon, tone] = KIND[e.kind] || KIND.change;
                            return (
                                <li key={i} className="relative">
                                    <span className={`absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full ${tone}`}><Icon size={11} /></span>
                                    <p className="text-[13px] font-medium text-slate-800">{e.title}</p>
                                    {e.detail && <p className="text-[12px] text-slate-500">{e.detail}</p>}
                                    <p className="text-[10.5px] text-slate-400">{e.at ? new Date(e.at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : ''}{e.by && ` · ${e.by}`}</p>
                                </li>);
                        })}
                        {events.length === 0 && <li className="text-[12.5px] text-slate-400">Nothing of that kind yet.</li>}
                    </ol>
                </Panel>
            )}
            {tab === 'materials' && (
                <Panel bodyClass="p-0">
                    {d.materials.length === 0 ? <EmptyState compact icon={PackageCheck} title="No material recorded" message="Issue material to this lot from the Stock page." /> : (
                        <table className="w-full text-[13px]"><thead><tr className="border-b border-border bg-slate-50/90">{['Item', 'Issued', 'Returned', 'Written off', 'Moved'].map((h2, i) => <th key={h2} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i ? 'text-right' : 'text-left'}`}>{h2}</th>)}</tr></thead>
                            <tbody>{d.materials.map(m => <tr key={m.item} className="border-b border-border/60"><td className="px-3 py-2 font-medium">{m.item}</td>{['issued', 'returned', 'wasted', 'moved'].map(k => <td key={k} className="tnum px-3 py-2 text-right">{num(m[k])} {m.uom}</td>)}</tr>)}</tbody></table>)}
                </Panel>
            )}
            {tab === 'people' && (
                <Panel bodyClass="p-0">
                    {d.people.length === 0 ? <EmptyState compact icon={Factory} title="No production yet" message="Nobody has recorded output on this lot." /> : (
                        <table className="w-full text-[13px]"><thead><tr className="border-b border-border bg-slate-50/90">{['Operator', 'Group', 'Pieces', 'Days', ...(d.people[0].earned != null ? ['Earned'] : [])].map((h2, i) => <th key={h2} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i > 1 ? 'text-right' : 'text-left'}`}>{h2}</th>)}</tr></thead>
                            <tbody>{d.people.map(p => <tr key={p.operator} className="border-b border-border/60"><td className="px-3 py-2 font-medium">{p.operator}</td><td className="px-3 py-2 text-slate-500">{p.group || '—'}</td>
                                <td className="tnum px-3 py-2 text-right">{num(p.pieces)}</td><td className="tnum px-3 py-2 text-right">{p.days}</td>{p.earned != null && <td className="tnum px-3 py-2 text-right">{inr(p.earned)}</td>}</tr>)}</tbody></table>)}
                </Panel>
            )}
        </div>
    );
}
