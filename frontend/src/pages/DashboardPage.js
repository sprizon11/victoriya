import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
    Package, TrendingUp, Factory, ArrowRight, CheckCircle2, Circle, ClipboardList,
} from 'lucide-react';
import { PageHeader, StatCard, Panel, EmptyState, Pill, AnimatedNumber, num, inr } from '../components/ui/primitives';
import { useAuth } from '../contexts/AuthContext';

const inr0 = (n) => inr(n, { decimals: 0 });
// the first three passed the colour-blind separation check together; use them in this order
const COLORS = ['#1F5FB4', '#00AD8D', '#E08700', '#7C5CBF', '#D14D72', '#4E8FBF'];

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

/** A white rounded card with a heading row; the one surface the dashboard is built from. */
function Card({ title, subtitle, actions, className = '', children }) {
    return (
        <section className={`lift rounded-[28px] border border-[#DCE5F2] bg-card p-6 shadow-[0_10px_30px_rgba(5,69,148,0.05)] ${className}`}>
            {(title || actions) && (
                <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <div className="min-w-0">
                        {title && <h2 className="font-outfit text-[19px] font-semibold text-slate-900">{title}</h2>}
                        {subtitle && <p className="text-[12.5px] text-slate-600">{subtitle}</p>}
                    </div>
                    {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
                </header>
            )}
            {children}
        </section>
    );
}

/** Small area trend with a marked last point. Values come from the payload; nothing is estimated. */
function Sparkline({ data, color, label }) {
    const w = 84, h = 34, vals = data.map(d => d.v), mx = Math.max(...vals), mn = Math.min(...vals);
    const pts = vals.map((v, i) => [Math.round((i * (w - 10)) / (vals.length - 1)) + 5, Math.round(h - 6 - ((v - mn) / (mx - mn || 1)) * (h - 12))]);
    const line = pts.map(p => p.join(',')).join(' ');
    const last = pts[pts.length - 1];
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0">
            <polygon points={`5,${h} ${line} ${last[0]},${h}`} fill={color} opacity="0.12" />
            <polyline points={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={last[0]} cy={last[1]} r="3.4" fill={color} stroke="#fff" strokeWidth="2" />
        </svg>
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
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    // today against a usual day (average of the last 7 days that had output); there is no target setting to compare with
    const ts = data.today_summary || { pieces: 0, usual_day: 0, entries: 0, lots: 0 };
    const todayPct = ts.usual_day > 0 ? Math.min(100, Math.round((ts.pieces / ts.usual_day) * 100)) : 0;
    const ring = 2 * Math.PI * 80;

    const kpis = [
        { key: 'pieces', label: 'Pieces this week', value: data.week.pieces, sub: delta(data.week.pieces, data.week.pieces_prev), subCls: data.week.pieces_prev ? (piecesUp ? 'text-emerald-700' : 'text-rose-700') : 'text-muted-foreground', spark: data.spark_pieces, color: '#1F5FB4' },
        ...(money ? [
            { key: 'wages', label: 'Wages this week', value: data.week.wages, format: inr0, sub: delta(data.week.wages, data.week.wages_prev), subCls: 'text-muted-foreground', spark: data.spark_wages, color: '#00AD8D' },
            { key: 'advances', label: 'Advances out', value: data.advances_outstanding, format: inr0, sub: 'still to recover', subCls: 'text-muted-foreground', color: '#E08700' },
        ] : []),
        { key: 'lots', label: 'Open lots', value: data.active_lots, sub: lateLots ? `${lateLots} late or at risk` : `${data.fy_summary.lots_started} started in FY ${data.fy}`, subCls: lateLots ? 'text-amber-700' : 'text-muted-foreground', color: '#1F5FB4' },
        ...(!isAdmin && money ? [{ key: 'bills', label: `Bills in ${data.expenses.month}`, value: data.expenses.total, format: inr0, sub: `${data.expenses.by_category.length} categories`, subCls: 'text-muted-foreground', color: '#E08700' }] : []),
    ];

    const TAG = { approvals: 'Approval', overdue: 'Late', at_risk: 'At risk', year_end: 'Year end', stock: 'Stock', bills: 'Bills', po: 'Order', enquiries: 'Enquiry' };
    const DOT = { rose: 'bg-rose-500', amber: 'bg-amber-500', slate: 'bg-brand' };

    const groupCard = (
        <Card title="This week by group" subtitle="Last 7 days">
            <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Group type">{[['', 'Operations'], ['operators', 'Operators']].map(([k, label]) => (
                <button key={k} onClick={() => setGroupFilter(k)} aria-pressed={groupFilter === k} className={`press flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[12px] font-medium ${groupFilter === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{label}</button>))}</div>
            {(() => {
                const rows = (groupFilter ? data.operator_groups : data.operation_groups) || [];
                const max = Math.max(1, ...rows.map(r => r.pieces));
                return rows.length === 0 ? <p className="py-6 text-center text-[12.5px] text-slate-500">No output this week.</p> : (
                    <ul className="space-y-3">{rows.map((r, i) => (
                        <li key={r.name}><div className="flex justify-between text-[13px]"><span className="font-medium text-slate-700">{r.name}</span>
                            <span className="tnum text-slate-600">{num(r.pieces)} pcs{r.wages != null && ` · ${inr0(r.wages)}`}</span></div>
                            <div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="bar-grow h-2 rounded-full" style={{ width: `${(r.pieces / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div></li>))}</ul>);
            })()}
        </Card>
    );

    const monthMoney = money ? [['Wages', data.money_month.wages, COLORS[0]], ['Bills and expenses', data.money_month.expenses, COLORS[1]], ['Advances out', data.money_month.advances_outstanding, COLORS[2]]] : [];
    const moneyTotal = Math.max(1, monthMoney.reduce((t, m) => t + m[1], 0));
    const donutR = 46, donutC = 2 * Math.PI * donutR;
    let donutOffset = 0;

    return (
        <div className="space-y-5" data-testid="dashboard-page">
            <header className="flex flex-wrap items-center gap-3">
                <div className="min-w-[240px] flex-1">
                    <p className="mb-1 text-[13px] text-slate-600">{todayText} · FY {data.fy}</p>
                    <h1 className="font-outfit text-[30px] font-semibold leading-tight tracking-tight text-slate-900">{greeting}, {user?.name?.split(' ')[0] || 'there'}</h1>
                </div>
                <div>
                    <label className="sr-only" htmlFor="fy-select">Financial year</label>
                    <select id="fy-select" value={data.fy} onChange={e => setFy(e.target.value)} data-testid="fy-select"
                        className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]">
                        {fyChoices.map(f => <option key={f} value={f}>FY {f}{f === data.current_fy ? ' (current)' : ''}</option>)}
                    </select>
                </div>
                {isAdmin && <>
                    <Link to="/lots/new" className="inline-flex h-11 items-center rounded-xl border border-border bg-white px-5 text-[13.5px] font-semibold text-brand-700 hover:bg-slate-50" data-testid="go-new-lot">New lot</Link>
                    <Link to="/production" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[13.5px] font-semibold text-white shadow-[0_12px_30px_rgba(5,69,148,0.28)] hover:bg-brand-600" data-testid="go-production">Enter production <ArrowRight size={15} /></Link>
                </>}
            </header>

            {showSetup && (
                <Panel title="Set up in this order" subtitle="Each step unlocks the next">
                    <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="setup-checklist">{setupSteps.map(([label, key, to], i) => {
                        const done = data.setup.counts[key] > 0;
                        return (<li key={key}><Link to={to} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${done ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-border hover:bg-slate-50'}`}>
                            {done ? <CheckCircle2 size={15} /> : <Circle size={15} className="text-slate-300" />}<span className="font-medium">{i + 1}. {label}</span>
                            <span className="ml-auto text-[11px] text-slate-500">{done ? `${data.setup.counts[key]} added` : 'to do'}</span></Link></li>);
                    })}</ol>
                </Panel>
            )}

            <section className="flex flex-wrap gap-5" data-testid="today-row">
                <div className="lift flex min-w-0 flex-[2_1_520px] flex-wrap items-center gap-x-10 gap-y-6 rounded-[28px] border border-[#DCE5F2] bg-card p-7 shadow-[0_10px_30px_rgba(5,69,148,0.06)]">
                    <div className="relative h-[180px] w-[180px] shrink-0">
                        <svg width="180" height="180" viewBox="0 0 190 190" role="img" aria-label={ts.usual_day > 0 ? `${num(ts.pieces)} pieces today, ${todayPct} percent of a usual day` : 'No usual day to compare with yet'}>
                            <circle cx="95" cy="95" r="80" fill="none" stroke="#E3EAF5" strokeWidth="16" />
                            <circle cx="95" cy="95" r="80" fill="none" stroke="#054594" strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(todayPct / 100) * ring} ${ring}`} transform="rotate(-90 95 95)" style={{ transition: 'stroke-dasharray .8s cubic-bezier(.22,1,.36,1)' }} />
                        </svg>
                        <div className="absolute inset-0 grid place-items-center text-center"><div>
                            <div className="tnum font-outfit text-[40px] font-semibold leading-none tracking-tight text-slate-900">{ts.usual_day > 0 ? `${todayPct}%` : '–'}</div>
                            <div className="mt-1 text-[12px] text-slate-600">of a usual day</div></div></div>
                    </div>
                    <div className="min-w-[220px] flex-1">
                        <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-brand">Today so far</p>
                        <div className="flex flex-wrap items-baseline gap-x-3"><span className="tnum font-outfit text-[52px] font-semibold leading-none tracking-tight text-slate-900" data-testid="today-pieces">{num(ts.pieces)}</span><span className="text-[16px] text-slate-600">pieces</span></div>
                        <p className="mb-4 mt-2 text-[14px] text-slate-700">{ts.usual_day > 0
                            ? (ts.pieces >= ts.usual_day ? `${num(ts.pieces - ts.usual_day)} above a usual day of ${num(ts.usual_day)}.` : `${num(ts.usual_day - ts.pieces)} to match a usual day of ${num(ts.usual_day)}.`)
                            : 'A usual day appears once a week of output has been entered.'}</p>
                        <div className="flex flex-wrap gap-2">
                            {[[ts.entries, 'entries today'], [ts.lots, 'lots in play'], [data.active_lots, 'open lots']].map(([v, l]) => (
                                <span key={l} className="rounded-xl bg-slate-100/80 px-3.5 py-2 text-[13px] text-slate-600"><b className="tnum font-outfit text-[18px] font-semibold text-slate-900">{v}</b> {l}</span>))}
                        </div>
                    </div>
                </div>

                {isAdmin ? (
                    <div className="lift min-w-0 flex-[1_1_320px] rounded-[28px] border border-[#DCE5F2] bg-card p-6 shadow-[0_10px_30px_rgba(5,69,148,0.06)]">
                        <div className="mb-2 flex items-center"><h2 className="font-outfit text-[19px] font-semibold text-slate-900">Needs you</h2>
                            {data.attention?.length > 0 && <span className="ml-auto rounded-full bg-amber-100 px-3 py-0.5 text-[13px] font-semibold text-amber-900">{data.attention.length}</span>}</div>
                        {data.attention?.length > 0 ? (
                            <ul data-testid="attention">{data.attention.map(a => (
                                <li key={a.key}><Link to={a.to} data-testid={`attn-${a.key}`} className="flex min-h-[48px] items-center gap-3 border-t border-[#E8EEF7] px-1 py-2.5 hover:bg-slate-50">
                                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[a.tone] || DOT.slate}`} />
                                    <span className="flex-1 text-[14px] leading-snug text-slate-800"><span className="mr-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{TAG[a.key] || 'Note'}</span>{a.label}</span>
                                    <strong className="tnum text-slate-900">{a.count}</strong><ArrowRight size={14} className="shrink-0 text-brand" /></Link></li>))}</ul>
                        ) : <EmptyState compact icon={CheckCircle2} title="All clear" message="Nothing needs you right now." />}
                    </div>
                ) : groupCard}
            </section>

            <section aria-label="Key numbers" className="stagger grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4" data-testid="kpis">
                {kpis.map((k, i) => (
                    <div key={k.key} style={{ '--i': i }} className="lift rounded-[22px] border border-[#DCE5F2] bg-card p-5 shadow-[0_10px_30px_rgba(5,69,148,0.05)]" data-testid={`kpi-${k.key}`}>
                        <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-slate-600">{k.label}</p>
                        <div className="my-2.5 flex items-end justify-between gap-3">
                            <span className="font-outfit text-[32px] font-semibold leading-none tracking-tight text-slate-900"><AnimatedNumber value={k.value} format={k.format || num} /></span>
                            {k.spark?.length > 1 && <Sparkline data={k.spark} color={k.color} label={`${k.label}, last 14 days`} />}
                        </div>
                        <p className={`text-[13px] font-medium ${k.subCls}`}>{k.sub}</p>
                    </div>))}
            </section>

            <section className="flex flex-wrap items-start gap-5">
                <Card className="min-w-0 flex-[1.3_1_480px]" title="Production, day by day" subtitle="Pieces handled, by operation group"
                    actions={<div className="flex gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Range">{[14, 30].map(n => (
                        <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`press cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium ${days === n ? 'bg-card text-brand shadow-xs' : 'text-slate-500'}`}>{n} days</button>))}</div>}>
                    <div className="h-72" role="img" aria-label={`Stacked bars of pieces handled per day for the last ${days} days`} data-testid="trend-chart">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={trend} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={days > 14 ? 3 : 0} tickLine={false} />
                                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <Tooltip content={<Tip />} />
                                {data.trend.groups.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                                {data.trend.groups.map((g, i) => <Bar key={g} dataKey={g} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false} />)}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card className="min-w-0 flex-[1_1_400px]" title="Lots on the floor" subtitle="A piece counts only once every operation has covered it"
                    actions={<Link to="/lots" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold text-brand hover:bg-brand-50">All lots <ArrowRight size={13} /></Link>}>
                    {pipeline.length === 0 ? <EmptyState compact icon={Package} title="No active lots" message="Create a lot to start recording production."
                        action={isAdmin && <Link to="/lots/new" className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white">Create a lot</Link>} /> : (
                        <ul data-testid="active-lots-card">{pipeline.slice(0, 6).map(l => {
                            const r = 23, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(100, l.progress || 0));
                            return (<li key={l.id} className="flex items-center gap-4 border-t border-[#E8EEF7] py-3.5 first:border-t-0" data-testid="lot-row">
                                <div className="relative h-[58px] w-[58px] shrink-0"><svg width="58" height="58" viewBox="0 0 58 58" role="img" aria-label={`${l.lot_number} is ${Math.round(pct)} percent finished`}>
                                    <circle cx="29" cy="29" r={r} fill="none" stroke="#E3EAF5" strokeWidth="7" />
                                    <circle cx="29" cy="29" r={r} fill="none" stroke={l.overdue ? '#B42318' : pct >= 90 ? '#00AD8D' : '#1F5FB4'} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 29 29)" /></svg>
                                    <span className="tnum absolute inset-0 grid place-items-center text-[13px] font-semibold text-slate-800">{Math.round(pct)}</span></div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-baseline gap-x-2.5"><b className="font-mono text-[13.5px] text-brand">{l.lot_number}</b><span className="truncate text-[14px] text-slate-800">{l.style_name}</span></div>
                                    <p className="mt-0.5 text-[12.5px] text-slate-600">{num(l.balance)} to go{l.slowest && pct < 100 ? ` · slowest: ${l.slowest}` : ''}{l.labour_cost != null ? ` · labour ${inr0(l.labour_cost)}` : ''}</p></div>
                                {l.overdue ? <Pill tone="rose">overdue · {l.due}</Pill> : l.at_risk ? <Pill tone="amber">may be late{l.projected_finish ? ` · ~${l.projected_finish}` : ''}</Pill> : l.due ? <span className="shrink-0 text-[12.5px] text-slate-600">due {l.due}</span> : null}
                            </li>);
                        })}</ul>)}
                </Card>
            </section>

            <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {money && (
                    <Card title={`Money · ${data.expenses.month}`} subtitle="Wages, bills and advances side by side">
                        <div className="flex flex-wrap items-center gap-6">
                            <svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label="Share of wages, bills and advances this month">
                                <g transform="rotate(-90 65 65)" fill="none" strokeWidth="20">{monthMoney.map(([label, v, color]) => {
                                    const len = Math.max(0, (v / moneyTotal) * donutC - 3);
                                    const el = <circle key={label} cx="65" cy="65" r={donutR} stroke={color} strokeDasharray={`${len} ${donutC}`} strokeDashoffset={-donutOffset} />;
                                    donutOffset += (v / moneyTotal) * donutC; return el;
                                })}</g></svg>
                            <ul className="min-w-[160px] flex-1 space-y-2.5">{monthMoney.map(([label, v, color]) => (
                                <li key={label} className="flex items-center gap-2.5 text-[13.5px]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} /><span className="text-slate-700">{label}</span>
                                    <span className="tnum ml-auto font-semibold">{inr0(v)}</span><span className="tnum w-9 text-right text-[11.5px] text-slate-500">{Math.round((v / moneyTotal) * 100)}%</span></li>))}</ul>
                        </div>
                        {data.expenses.by_category.length > 0 && <p className="mt-4 border-t border-[#E8EEF7] pt-3 text-[12.5px] text-slate-600">Bills: {data.expenses.by_category.slice(0, 4).map(c => `${c.category} ${inr0(c.total)}`).join(' · ')}</p>}
                    </Card>
                )}
                <Card title="Stock running low" actions={<Link to="/stock" className="text-[13px] font-semibold text-brand">Open stock</Link>}>
                    {data.stock.low.length === 0 ? <p className="py-6 text-center text-[12.5px] text-slate-500">{data.stock.count ? 'Everything is above its reorder level.' : 'No stock items yet.'}</p> : (
                        <ul className="space-y-3.5">{data.stock.low.map(s => {
                            const pct = s.reorder_level > 0 ? Math.max(4, Math.min(100, (s.balance / s.reorder_level) * 100)) : 4;
                            return (<li key={s.name} className="text-[13.5px]"><div className="flex items-center gap-2"><span className="flex-1 truncate font-medium text-slate-800">{s.name}</span>
                                <span className="tnum font-semibold text-amber-800">{s.balance} {s.uom}</span><span className="text-[11.5px] text-slate-500">of {s.reorder_level}</span></div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} /></div></li>);
                        })}</ul>)}
                </Card>
                {isAdmin && (
                    <Card title="Recent activity" actions={<Link to="/audit" className="text-[13px] font-semibold text-brand">Activity log</Link>}>
                        {data.recent_activity.length === 0 ? <p className="py-6 text-center text-[12.5px] text-slate-500">Nothing yet.</p> : (
                            <ul className="space-y-3">{data.recent_activity.map((a, i) => (
                                <li key={i} className="flex gap-3 text-[13px] leading-snug"><span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-leaf" />
                                    <span><span className="font-medium text-slate-800">{a.user || 'Someone'}</span> <span className="text-slate-600">{a.summary}</span>
                                        <span className="block text-[11.5px] text-slate-500">{new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></span></li>))}</ul>)}
                    </Card>
                )}
                {isAdmin && groupCard}
            </section>
        </div>
    );
}
