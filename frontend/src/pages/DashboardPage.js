import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line,
} from 'recharts';
import {
    Package, TrendingUp, IndianRupee, Factory, ArrowRight, Wallet, Boxes, Receipt, AlertTriangle, CheckCircle2, Circle, ClipboardList,
} from 'lucide-react';
import { PageHeader, StatCard, Panel, EmptyState, Meter, Pill, num, inr } from '../components/ui/primitives';
import { useAuth } from '../contexts/AuthContext';

const inr0 = (n) => inr(n, { decimals: 0 });
const COLORS = ['#294F96', '#00AF92', '#E08700', '#7C5CBF', '#D14D72', '#4E8FBF'];
const TONE = { rose: 'bg-rose-50 text-rose-700 ring-rose-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', slate: 'bg-slate-100 text-slate-700 ring-slate-200' };

const delta = (now, prev) => {
    if (!prev) return now ? 'new this week' : 'no change';
    const p = Math.round(((now - prev) / prev) * 100);
    return `${p >= 0 ? '+' : ''}${p}% vs last week`;
};

/** A tiny trend line with no axes: the number next to it is what matters. */
function Spark({ data, color = '#294F96', label }) {
    if (!data?.length) return null;
    return (
        <div className="h-8 w-full" role="img" aria-label={label}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                    <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

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

    return (
        <div className="space-y-4" data-testid="dashboard-page">
            <PageHeader title={`Hello, ${user?.name?.split(' ')[0] || 'there'}`} subtitle="Victoria Garments, Tiruppur · how the unit is doing" icon={Factory}
                actions={
                    <div className="flex items-center gap-2">
                        <label className="sr-only" htmlFor="fy-select">Financial year</label>
                        <select id="fy-select" value={data.fy} onChange={e => setFy(e.target.value)} data-testid="fy-select"
                            className="h-8 rounded-md border border-input bg-white px-2 text-[12px]">
                            {fyChoices.map(f => <option key={f} value={f}>FY {f}{f === data.current_fy ? ' (current)' : ''}</option>)}
                        </select>
                    </div>} />

            {showSetup && (
                <Panel title="Set up in this order" subtitle="Each step unlocks the next" data-testid="setup-checklist">
                    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{setupSteps.map(([label, key, to], i) => {
                        const done = data.setup.counts[key] > 0;
                        return (<li key={key}><Link to={to} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${done ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-border hover:bg-slate-50'}`}>
                            {done ? <CheckCircle2 size={15} /> : <Circle size={15} className="text-slate-300" />}<span className="font-medium">{i + 1}. {label}</span>
                            <span className="ml-auto text-[11px] text-slate-400">{done ? `${data.setup.counts[key]} added` : 'to do'}</span></Link></li>);
                    })}</ol>
                </Panel>
            )}

            {isAdmin && data.attention?.length > 0 && (
                <Panel title="Needs your attention" bodyClass="p-2" data-testid="attention">
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.attention.map(a => (
                        <li key={a.key}><Link to={a.to} data-testid={`attn-${a.key}`}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] ring-1 ring-inset hover:brightness-95 ${TONE[a.tone]}`}>
                            <AlertTriangle size={14} className="shrink-0" /><span className="flex-1">{a.label}</span><strong className="tnum">{a.count}</strong><ArrowRight size={12} /></Link></li>))}</ul>
                </Panel>
            )}

            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-6">
                <div className="space-y-1"><StatCard i={0} label="Active lots" value={data.active_lots} icon={Package} tone="brand" sub={`${data.fy_summary.lots_started} started in FY ${data.fy}`} /></div>
                <div className="space-y-1"><StatCard i={1} label="Pieces this week" value={data.week.pieces} icon={TrendingUp} tone="leaf" sub={delta(data.week.pieces, data.week.pieces_prev)} />
                    <Spark data={data.spark_pieces} color="#00AF92" label="Pieces per day, last 14 days" /></div>
                {money && <div className="space-y-1"><StatCard i={2} label="Wages this week" value={data.week.wages} format={inr0} icon={IndianRupee} tone="amber" sub={delta(data.week.wages, data.week.wages_prev)} />
                    <Spark data={data.spark_wages} color="#E08700" label="Wages per day, last 14 days" /></div>}
                {money && <StatCard i={3} label="Advances to recover" value={data.advances_outstanding} format={inr0} icon={Wallet} tone="slate" sub="outstanding" />}
                {money && <StatCard i={4} label={`Bills in ${data.expenses.month}`} value={data.expenses.total} format={inr0} icon={Receipt} tone="brand" sub={`${data.expenses.by_category.length} categories`} />}
                <StatCard i={5} label="Stock alerts" value={data.stock.low.length} icon={Boxes} tone={data.stock.low.length ? 'amber' : 'leaf'} sub={data.stock.low.length ? 'at or below reorder level' : `${data.stock.count} items, all fine`} />
            </div>

            <Panel title="Lot pipeline" subtitle="Progress counts a piece only once every operation has covered it"
                actions={<Link to="/lots" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-brand hover:bg-brand-50">All lots <ArrowRight size={12} /></Link>} bodyClass="p-2" data-testid="active-lots-card">
                {pipeline.length === 0 ? <EmptyState compact icon={Package} title="No active lots" message="Create a lot to start recording production."
                    action={isAdmin && <Link to="/lots/new" className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white">Create a lot</Link>} /> : (
                    <div className="stagger">{pipeline.map((l, i) => (
                        <div key={l.id} style={{ '--i': i }} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-brand-50/50">
                            <span className="w-24 font-mono text-[12px] font-semibold text-brand">{l.lot_number}</span>
                            <span className="min-w-[120px] flex-1 truncate text-[13px] font-medium text-slate-800">{l.style_name}</span>
                            <div className="w-40"><Meter value={l.progress} /><p className="tnum mt-0.5 text-[10.5px] text-slate-400">{num(l.produced)}/{num(l.planned)}{l.slowest && l.progress < 100 ? ` · slowest: ${l.slowest}` : ''}</p></div>
                            <span className="w-28 text-[11.5px]">
                                {l.overdue ? <Pill tone="rose">overdue · due {l.due}</Pill> : l.at_risk ? <Pill tone="amber">may be late{l.projected_finish ? ` · ~${l.projected_finish}` : ''}</Pill>
                                    : <span className="text-slate-400">{l.due ? `due ${l.due}` : ''}</span>}</span>
                            {l.labour_cost != null && <span className="tnum w-24 text-right text-[12px] text-slate-500">{inr0(l.labour_cost)}</span>}
                        </div>))}</div>
                )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
                <Panel title="Production, day by day" subtitle="Pieces handled, by operation group" className="lg:col-span-2" bodyClass="p-2"
                    actions={<div className="flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Range">{[14, 30].map(n => (
                        <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`press cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium ${days === n ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{n} days</button>))}</div>}>
                    <div className="h-64" role="img" aria-label={`Stacked bars of pieces handled per day for the last ${days} days`}>
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
                <Panel title="This week by group" subtitle="Last 7 days" bodyClass="p-2">
                    <div className="mb-2 flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Group type">{[['', 'Operations'], ['operators', 'Operators']].map(([k, label]) => (
                        <button key={k} onClick={() => setGroupFilter(k)} aria-pressed={groupFilter === k} className={`press flex-1 cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium ${groupFilter === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{label}</button>))}</div>
                    {(() => {
                        const rows = (groupFilter ? data.operator_groups : data.operation_groups) || [];
                        const max = Math.max(1, ...rows.map(r => r.pieces));
                        return rows.length === 0 ? <p className="px-2 py-6 text-center text-[12px] text-slate-400">No output this week.</p> : (
                            <ul className="space-y-2 px-1">{rows.map((r, i) => (
                                <li key={r.name}><div className="flex justify-between text-[12px]"><span className="font-medium text-slate-700">{r.name}</span>
                                    <span className="tnum text-slate-500">{num(r.pieces)} pcs{r.wages != null && ` · ${inr0(r.wages)}`}</span></div>
                                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-100"><div className="bar-grow h-1.5 rounded-full" style={{ width: `${(r.pieces / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div></li>))}</ul>);
                    })()}
                </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                {money && (
                    <Panel title={`Money · ${data.expenses.month}`} subtitle="Wages, bills and advances side by side" bodyClass="p-3">
                        {[['Wages', data.money_month.wages, '#E08700'], ['Bills', data.money_month.expenses, '#294F96'], ['Advances out', data.money_month.advances_outstanding, '#7C5CBF']].map(([label, v, color]) => {
                            const max = Math.max(1, data.money_month.wages, data.money_month.expenses, data.money_month.advances_outstanding);
                            return <div key={label} className="mb-2.5"><div className="flex justify-between text-[12px]"><span className="text-slate-600">{label}</span><span className="tnum font-semibold">{inr0(v)}</span></div>
                                <div className="mt-0.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div></div>;
                        })}
                        {data.expenses.by_category.length > 0 && <p className="mt-2 text-[11.5px] text-slate-500">Bills: {data.expenses.by_category.slice(0, 4).map(c => `${c.category} ${inr0(c.total)}`).join(' · ')}</p>}
                    </Panel>
                )}
                <Panel title="Stock running low" bodyClass="p-2" actions={<Link to="/stock" className="text-[11.5px] font-medium text-brand">Open stock</Link>}>
                    {data.stock.low.length === 0 ? <p className="px-2 py-6 text-center text-[12px] text-slate-400">{data.stock.count ? 'Everything is above its reorder level.' : 'No stock items yet.'}</p> : (
                        <ul className="divide-y divide-border/60">{data.stock.low.map(s => (
                            <li key={s.name} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px]"><span className="flex-1 truncate font-medium">{s.name}</span>
                                <span className="tnum text-rose-600">{s.balance} {s.uom}</span><span className="text-[10.5px] text-slate-400">of {s.reorder_level}</span></li>))}</ul>)}
                </Panel>
                {isAdmin && (
                    <Panel title="Recent activity" bodyClass="p-2" actions={<Link to="/audit" className="text-[11.5px] font-medium text-brand">Activity log</Link>}>
                        {data.recent_activity.length === 0 ? <p className="px-2 py-6 text-center text-[12px] text-slate-400">Nothing yet.</p> : (
                            <ul className="divide-y divide-border/60">{data.recent_activity.map((a, i) => (
                                <li key={i} className="px-2 py-1.5 text-[12px]"><span className="font-medium text-slate-700">{a.user || 'Someone'}</span> <span className="text-slate-500">{a.summary}</span>
                                    <span className="block text-[10.5px] text-slate-400">{new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></li>))}</ul>)}
                    </Panel>
                )}
            </div>
        </div>
    );
}
