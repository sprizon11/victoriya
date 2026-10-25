import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
    Package, TrendingUp, Factory, ArrowRight, CheckCircle2, Circle, ClipboardList,
} from 'lucide-react';
import { PageHeader, StatCard, Panel, EmptyState, Meter, Pill, AnimatedNumber, num, inr } from '../components/ui/primitives';
import { useAuth } from '../contexts/AuthContext';

const inr0 = (n) => inr(n, { decimals: 0 });
const COLORS = ['#294F96', '#00AF92', '#9DB3E0', '#E08700', '#7C5CBF', '#D14D72'];

const delta = (now, prev) => {
    if (!prev) return now ? 'new this week' : 'no change';
    const p = Math.round(((now - prev) / prev) * 100);
    return `${p >= 0 ? '+' : ''}${p}% vs last week`;
};

function Tip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-card px-2.5 py-2 shadow-pop">
            <p className="mb-1 text-[11px] font-semibold text-slate-800">{label}</p>
            {payload.filter(p => p.value).map(p => <p key={p.dataKey} className="tnum text-[11px] text-slate-600"><span style={{ color: p.color }}>■</span> {p.dataKey}: {num(p.value)} pcs</p>)}
        </div>
    );
}

export default function DashboardPage() {
    const { user } = useAuth();
    const [fy, setFy] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [days, setDays] = useState(14);
    const [groupFilter, setGroupFilter] = useState('');

    useEffect(() => {
        setLoading(true);
        api.get('/dashboard/overview', { params: fy ? { fy } : {} })
            .then(r => { setData(r.data); setError(false); })
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [fy]);

    const trend = useMemo(() => (data ? data.trend.rows.slice(-days).map(r => ({ ...r, label: r.date.slice(5) })) : []), [data, days]);

    if (loading && !data) {
        return (
            <div className="space-y-4" data-testid="dashboard-page">
                <div className="skeleton h-8 w-64" />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map(i => <StatCard key={i} loading />)}</div>
                <div className="skeleton h-56 w-full rounded-xl" />
            </div>
        );
    }
    if (error || !data) {
        return <EmptyState icon={Factory} title="Dashboard unavailable" message="Could not reach the server. Check that the backend is running, then reload." />;
    }

    const isAdmin = data.role === 'admin';
    const money = data.role !== 'data_entry' && data.week.wages != null;
    const fyChoices = (() => {
        const cur = 2000 + parseInt(data.current_fy.split('-')[0], 10);
        return [0, 1, 2].map(i => { const s = cur - i; return `${String(s).slice(2)}-${String(s + 1).slice(2)}`; });
    })();

    // ---------------------------------------------------------------- data entry
    if (data.role === 'data_entry') {
        return (
            <div className="space-y-4" data-testid="dashboard-page">
                <PageHeader title={`Hello, ${user?.name?.split(' ')[0] || 'there'}`} subtitle="Record today's output" icon={ClipboardList}
                    actions={<Link to="/production" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-brand-600" data-testid="go-production">Enter production <ArrowRight size={14} /></Link>} />
                <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <StatCard i={0} label="Pieces you entered this week" value={data.week.pieces} icon={TrendingUp} tone="leaf" sub={delta(data.week.pieces, data.week.pieces_prev)} />
                    <StatCard i={1} label="Entries you made" value={data.my_week_entries} icon={ClipboardList} tone="brand" sub="last 7 days" />
                    <StatCard i={2} label="Lots open for entry" value={data.active_lots} icon={Package} tone="amber" />
                </div>
                <Panel title="Lots that still need output" bodyClass="p-2">
                    {data.needs_output.length === 0 ? <EmptyState compact icon={Package} title="Nothing to enter" message="No open lot has pieces left to make." /> : (
                        <ul className="divide-y divide-border/60">{data.needs_output.map(l => (
                            <li key={l.id} className="flex items-center gap-3 px-2 py-2 text-[13px]"><span className="font-mono text-[12px] font-semibold text-brand">{l.lot_number}</span>
                                <span className="flex-1 truncate">{l.style_name}</span><span className="tnum text-slate-500">{num(l.balance)} to go</span>{l.due && <span className="text-[11px] text-slate-400">due {l.due}</span>}</li>))}</ul>
                    )}
                </Panel>
            </div>
        );
    }

    // ---------------------------------------------------------------- admin / accounts
    const pipeline = data.lots;
    const setupSteps = data.setup ? [['Operators', 'operators', '/operators'], ['Operations', 'operations', '/operations'], ['Colours', 'colors', '/colors'],
        ['Size charts', 'size_charts', '/size-charts'], ['Weeks', 'weeks', '/weeks'], ['A first lot', 'lots', '/lots/new']] : [];
    const showSetup = data.setup && !data.setup.done;
    const lateLots = pipeline.filter(l => l.overdue || l.at_risk).length;
    const waiting = data.attention?.find(a => a.key === 'approvals')?.count || 0;
    const [ty, tm, td] = data.today.split('-').map(Number);
    const todayText = new Date(ty, tm - 1, td).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const piecesUp = data.week.pieces >= (data.week.pieces_prev || 0);

    const kpis = [
        { key: 'pieces', label: 'Pieces this week', value: data.week.pieces, sub: delta(data.week.pieces, data.week.pieces_prev), subCls: data.week.pieces_prev ? (piecesUp ? 'text-emerald-700' : 'text-rose-700') : 'text-muted-foreground', accent: '#294F96' },
        { key: 'lots', label: 'Open lots', value: data.active_lots, sub: lateLots ? `${lateLots} late or at risk` : `${data.fy_summary.lots_started} started in FY ${data.fy}`, subCls: lateLots ? 'text-amber-700' : 'text-muted-foreground', accent: '#00AF92' },
        ...(money ? [
            { key: 'wages', label: 'Wages this week', value: data.week.wages, format: inr0, sub: delta(data.week.wages, data.week.wages_prev), subCls: 'text-muted-foreground', accent: '#294F96' },
            { key: 'advances', label: 'Advances out', value: data.advances_outstanding, format: inr0, sub: 'still to recover', subCls: 'text-muted-foreground', accent: '#9DB3E0' },
        ] : []),
        isAdmin
            ? { key: 'approvals', label: 'Waiting for approval', value: waiting, sub: waiting ? 'needs a decision' : 'nothing waiting', subCls: waiting ? 'text-rose-700' : 'text-emerald-700', accent: '#D97706' }
            : { key: 'bills', label: `Bills in ${data.expenses.month}`, value: data.expenses.total, format: inr0, sub: `${data.expenses.by_category.length} categories`, subCls: 'text-muted-foreground', accent: '#D97706' },
    ];

    const TAG = { approvals: 'Approval', overdue: 'Late', at_risk: 'At risk', year_end: 'Year end', stock: 'Stock', bills: 'Bills', po: 'Order', enquiries: 'Enquiry' };
    const ROW = { rose: 'bg-rose-50 hover:bg-rose-100/70', amber: 'bg-amber-50 hover:bg-amber-100/70', slate: 'bg-slate-50 hover:bg-slate-100' };
    const CHIP = { rose: 'border-rose-300 text-rose-700', amber: 'border-amber-300 text-amber-800', slate: 'border-slate-300 text-slate-600' };

    const groupPanel = (
        <Panel title="This week by group" subtitle="Last 7 days" bodyClass="p-3.5">
            <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Group type">{[['', 'Operations'], ['operators', 'Operators']].map(([k, label]) => (
                <button key={k} onClick={() => setGroupFilter(k)} aria-pressed={groupFilter === k} className={`press flex-1 cursor-pointer rounded-md px-2 py-1 text-[11.5px] font-medium ${groupFilter === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{label}</button>))}</div>
            {(() => {
                const rows = (groupFilter ? data.operator_groups : data.operation_groups) || [];
                const max = Math.max(1, ...rows.map(r => r.pieces));
                return rows.length === 0 ? <p className="py-6 text-center text-[12px] text-slate-400">No output this week.</p> : (
                    <ul className="space-y-2.5">{rows.map((r, i) => (
                        <li key={r.name}><div className="flex justify-between text-[12.5px]"><span className="font-medium text-slate-700">{r.name}</span>
                            <span className="tnum text-slate-500">{num(r.pieces)} pcs{r.wages != null && ` · ${inr0(r.wages)}`}</span></div>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="bar-grow h-1.5 rounded-full" style={{ width: `${(r.pieces / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div></li>))}</ul>);
            })()}
        </Panel>
    );

    const monthMoney = money ? [['Wages', data.money_month.wages, COLORS[0]], ['Bills and expenses', data.money_month.expenses, COLORS[1]], ['Advances out', data.money_month.advances_outstanding, COLORS[2]]] : [];
    const moneyTotal = Math.max(1, monthMoney.reduce((t, m) => t + m[1], 0));

    return (
        <div className="space-y-5" data-testid="dashboard-page">
            <header className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                    <p className="mb-1 text-[12px] text-muted-foreground">{todayText} · FY {data.fy}</p>
                    <h1 className="font-outfit text-[26px] font-semibold leading-tight text-slate-900">Hello, {user?.name?.split(' ')[0] || 'there'}</h1>
                </div>
                <div>
                    <label className="sr-only" htmlFor="fy-select">Financial year</label>
                    <select id="fy-select" value={data.fy} onChange={e => setFy(e.target.value)} data-testid="fy-select"
                        className="h-10 rounded-lg border border-input bg-white px-3 text-[13px]">
                        {fyChoices.map(f => <option key={f} value={f}>FY {f}{f === data.current_fy ? ' (current)' : ''}</option>)}
                    </select>
                </div>
                {isAdmin && <>
                    <Link to="/lots/new" className="inline-flex h-10 items-center rounded-lg border border-border bg-white px-4 text-[13px] font-semibold text-brand-700 hover:bg-slate-50" data-testid="go-new-lot">New lot</Link>
                    <Link to="/production" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white hover:bg-brand-600" data-testid="go-production">Enter production <ArrowRight size={14} /></Link>
                </>}
            </header>

            {showSetup && (
                <Panel title="Set up in this order" subtitle="Each step unlocks the next">
                    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="setup-checklist">{setupSteps.map(([label, key, to], i) => {
                        const done = data.setup.counts[key] > 0;
                        return (<li key={key}><Link to={to} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${done ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-border hover:bg-slate-50'}`}>
                            {done ? <CheckCircle2 size={15} /> : <Circle size={15} className="text-slate-300" />}<span className="font-medium">{i + 1}. {label}</span>
                            <span className="ml-auto text-[11px] text-slate-400">{done ? `${data.setup.counts[key]} added` : 'to do'}</span></Link></li>);
                    })}</ol>
                </Panel>
            )}

            <section aria-label="Key numbers" className="stagger grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5" data-testid="kpis">
                {kpis.map((k, i) => (
                    <div key={k.key} style={{ '--i': i, borderTop: `3px solid ${k.accent}` }} className="rounded-xl border border-border bg-card p-4 shadow-card" data-testid={`kpi-${k.key}`}>
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{k.label}</p>
                        <p className="mt-2 font-outfit text-[28px] font-semibold leading-none text-slate-900"><AnimatedNumber value={k.value} format={k.format || num} /></p>
                        <p className={`mt-2 text-[12px] ${k.subCls}`}>{k.sub}</p>
                    </div>))}
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
                <Panel title="Production, day by day" subtitle="Pieces handled, by operation group" className="lg:col-span-2" bodyClass="p-3.5"
                    actions={<div className="flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Range">{[14, 30].map(n => (
                        <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`press cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium ${days === n ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{n} days</button>))}</div>}>
                    <div className="h-72" role="img" aria-label={`Stacked bars of pieces handled per day for the last ${days} days`} data-testid="trend-chart">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={days > 14 ? 3 : 0} tickLine={false} />
                                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<Tip />} />
                                {data.trend.groups.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                                {data.trend.groups.map((g, i) => <Bar key={g} dataKey={g} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false} />)}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Panel>

                {isAdmin ? (
                    <Panel title="Needs your attention" bodyClass="p-3">
                        {data.attention?.length > 0 ? (
                            <ul className="space-y-2" data-testid="attention">{data.attention.map(a => (
                                <li key={a.key}><Link to={a.to} data-testid={`attn-${a.key}`} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors ${ROW[a.tone] || ROW.slate}`}>
                                    <span className={`shrink-0 rounded-full border bg-white px-2 py-0.5 text-[10.5px] font-semibold ${CHIP[a.tone] || CHIP.slate}`}>{TAG[a.key] || 'Note'}</span>
                                    <span className="flex-1 leading-snug text-slate-800">{a.label}</span>
                                    <strong className="tnum text-slate-900">{a.count}</strong><ArrowRight size={13} className="shrink-0 text-slate-400" /></Link></li>))}</ul>
                        ) : <EmptyState compact icon={CheckCircle2} title="All clear" message="Nothing needs you right now." />}
                    </Panel>
                ) : groupPanel}
            </div>

            <Panel title="Lot pipeline" subtitle="A piece counts only once every operation has covered it"
                actions={<Link to="/lots" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-brand hover:bg-brand-50">All lots <ArrowRight size={12} /></Link>} bodyClass="p-0">
                {pipeline.length === 0 ? <EmptyState compact icon={Package} title="No active lots" message="Create a lot to start recording production."
                    action={isAdmin && <Link to="/lots/new" className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white">Create a lot</Link>} /> : (
                    <div className="overflow-x-auto" data-testid="active-lots-card">
                        <table className="w-full min-w-[720px] text-[13px]">
                            <thead><tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                <th className="px-4 py-2.5">Lot</th><th className="px-2 py-2.5">Style</th><th className="w-[30%] px-2 py-2.5">Progress</th>
                                <th className="px-2 py-2.5 text-right">To go</th><th className="px-2 py-2.5 text-right">Due</th>{money && <th className="px-4 py-2.5 text-right">Labour</th>}</tr></thead>
                            <tbody>{pipeline.map(l => (
                                <tr key={l.id} className="border-b border-border/60 last:border-0 transition-colors hover:bg-brand-50/50" data-testid="lot-row">
                                    <td className="px-4 py-3 font-mono text-[12px] font-semibold text-brand">{l.lot_number}</td>
                                    <td className="max-w-[220px] truncate px-2 py-3 font-medium text-slate-800">{l.style_name}</td>
                                    <td className="px-2 py-3"><Meter value={l.progress} /><p className="tnum mt-0.5 text-[10.5px] text-slate-400">{num(l.produced)} of {num(l.planned)}{l.slowest && l.progress < 100 ? ` · slowest: ${l.slowest}` : ''}</p></td>
                                    <td className="tnum px-2 py-3 text-right">{num(l.balance)}</td>
                                    <td className="px-2 py-3 text-right text-[12px]">
                                        {l.overdue ? <Pill tone="rose">overdue · {l.due}</Pill> : l.at_risk ? <Pill tone="amber">may be late{l.projected_finish ? ` · ~${l.projected_finish}` : ''}</Pill>
                                            : <span className="text-slate-500">{l.due || '—'}</span>}</td>
                                    {money && <td className="tnum px-4 py-3 text-right text-slate-600">{l.labour_cost != null ? inr0(l.labour_cost) : '—'}</td>}
                                </tr>))}</tbody>
                        </table>
                    </div>)}
            </Panel>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {money && (
                    <Panel title={`Money · ${data.expenses.month}`} subtitle="Wages, bills and advances side by side" bodyClass="p-4">
                        <div className="flex h-3.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Share of wages, bills and advances this month">
                            {monthMoney.map(([label, v, color]) => <div key={label} style={{ flex: `${v} 1 0`, background: color }} />)}
                        </div>
                        <ul className="mt-3 space-y-2">{monthMoney.map(([label, v, color]) => (
                            <li key={label} className="flex items-center gap-2.5 text-[13px]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} /><span className="text-slate-600">{label}</span>
                                <span className="tnum ml-auto font-semibold">{inr0(v)}</span><span className="tnum w-9 text-right text-[11px] text-slate-400">{Math.round((v / moneyTotal) * 100)}%</span></li>))}</ul>
                        {data.expenses.by_category.length > 0 && <p className="mt-3 border-t border-border/60 pt-2 text-[11.5px] text-slate-500">Bills: {data.expenses.by_category.slice(0, 4).map(c => `${c.category} ${inr0(c.total)}`).join(' · ')}</p>}
                    </Panel>
                )}
                <Panel title="Stock running low" bodyClass="p-3.5" actions={<Link to="/stock" className="text-[12px] font-semibold text-brand">Open stock</Link>}>
                    {data.stock.low.length === 0 ? <p className="py-6 text-center text-[12px] text-slate-400">{data.stock.count ? 'Everything is above its reorder level.' : 'No stock items yet.'}</p> : (
                        <ul className="space-y-3">{data.stock.low.map(s => {
                            const pct = s.reorder_level > 0 ? Math.max(4, Math.min(100, (s.balance / s.reorder_level) * 100)) : 4;
                            return (<li key={s.name} className="text-[13px]"><div className="flex items-center gap-2"><span className="flex-1 truncate font-medium text-slate-800">{s.name}</span>
                                <span className="tnum font-semibold text-amber-800">{s.balance} {s.uom}</span><span className="text-[10.5px] text-slate-400">of {s.reorder_level}</span></div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} /></div></li>);
                        })}</ul>)}
                </Panel>
                {isAdmin && (
                    <Panel title="Recent activity" bodyClass="p-3.5" actions={<Link to="/audit" className="text-[12px] font-semibold text-brand">Activity log</Link>}>
                        {data.recent_activity.length === 0 ? <p className="py-6 text-center text-[12px] text-slate-400">Nothing yet.</p> : (
                            <ul className="space-y-2.5">{data.recent_activity.map((a, i) => (
                                <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug"><span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-leaf" />
                                    <span><span className="font-medium text-slate-700">{a.user || 'Someone'}</span> <span className="text-slate-500">{a.summary}</span>
                                        <span className="block text-[10.5px] text-slate-400">{new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></span></li>))}</ul>)}
                    </Panel>
                )}
                {isAdmin && groupPanel}
            </div>
        </div>
    );
}
