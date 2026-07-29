import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
    Package, Users, TrendingUp, IndianRupee, Factory, Trophy, ArrowRight, Layers,
} from 'lucide-react';
import {
    PageHeader, StatCard, Panel, EmptyState, Meter, Pill, AnimatedNumber, inr, num,
} from '../components/ui/primitives';

const inr0 = (n) => (Number(n) || 0).toLocaleString('en-IN',
    { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const CHART_COLORS = ['#294F96', '#00AF92', '#E08700', '#7C5CBF', '#D14D72'];

function ChartTip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg border border-border bg-card px-2.5 py-2 shadow-pop">
            <p className="mb-1 text-[11px] font-semibold text-slate-800">{label}</p>
            {payload.map(p => (
                <p key={p.dataKey} className="tnum text-[11px] text-slate-600">
                    {num(p.value)} pcs
                </p>
            ))}
        </div>
    );
}

export default function DashboardPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        api.get('/dashboard/summary')
            .then(r => setData(r.data))
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="space-y-4" data-testid="dashboard-page">
                <div className="skeleton h-8 w-64" />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[0, 1, 2, 3].map(i => <StatCard key={i} loading />)}
                </div>
                <div className="skeleton h-56 w-full rounded-xl" />
                <div className="grid gap-3 lg:grid-cols-2">
                    <div className="skeleton h-72 rounded-xl" />
                    <div className="skeleton h-72 rounded-xl" />
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <EmptyState
                icon={Factory}
                title="Dashboard unavailable"
                message="Could not reach the server. Check that the backend is running, then reload."
            />
        );
    }

    const lots = data.lots || [];
    const opStats = (data.operation_stats || []).slice().sort((a, b) => b.total_qty - a.total_qty);
    const topOps = data.top_operators || [];
    const maxEarn = Math.max(1, ...topOps.map(o => o.total_earnings || 0));

    return (
        <div className="space-y-4" data-testid="dashboard-page">
            <PageHeader
                title="Production overview"
                subtitle={`Victoria Garments, Tiruppur — live figures for the current week`}
                icon={Factory}
                actions={
                    <Pill tone="brand" className="px-2.5 py-1 text-[11px]">
                        Week {data.week_number} · {data.year}
                    </Pill>
                }
            />

            {/* ------------------------------------------------------- KPIs */}
            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard i={0} label="Active lots" value={data.active_lots} icon={Package} tone="brand"
                    sub={`${lots.length} in production`} />
                <StatCard i={1} label="Operators" value={data.total_operators} icon={Users} tone="leaf"
                    sub="on the active roster" />
                <StatCard i={2} label="Week production" value={data.week_production} icon={TrendingUp} tone="amber"
                    sub="pieces recorded this week" />
                <StatCard i={3} label="Week wages" value={data.week_earnings} icon={IndianRupee} tone="slate"
                    format={inr0} sub="gross, before advances" />
            </div>

            {/* -------------------------------------------------- lot progress */}
            <Panel
                title="Active lot progress"
                subtitle="A piece counts as produced once every operation on the lot has covered it"
                actions={
                    <Link to="/lots"
                        className="press inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1
                            text-[11.5px] font-medium text-brand hover:bg-brand-50">
                        All lots <ArrowRight size={12} />
                    </Link>
                }
                bodyClass="p-2"
                data-testid="active-lots-card"
            >
                {lots.length > 0 ? (
                    <div className="stagger">
                        {lots.map((lot, i) => (
                            <div key={lot.id} style={{ '--i': i }}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2
                                    transition-colors duration-150 hover:bg-brand-50/50">
                                <div className="min-w-[190px] flex-1">
                                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-800">
                                        <span className="font-mono text-[12px] font-semibold text-brand">{lot.lot_number}</span>
                                        <span className="text-slate-300">·</span>
                                        <span className="truncate">{lot.style_name}</span>
                                    </p>
                                    <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
                                        {num(lot.total_produced_qty)} / {num(lot.total_planned_qty)} pcs
                                        <span className="ml-2 text-slate-400">
                                            {num(lot.balance_qty)} to go
                                        </span>
                                    </p>
                                </div>
                                <Meter value={lot.progress} className="w-full min-w-[160px] flex-[2] sm:w-auto" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        compact icon={Package}
                        title="No active lots"
                        message="Create a lot to start recording production against it."
                        action={
                            <Link to="/lots"
                                className="press inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand
                                    px-3 py-2 text-[13px] font-medium text-white shadow-card hover:bg-brand-600">
                                <Package size={14} /> Go to Lots
                            </Link>
                        }
                    />
                )}
            </Panel>

            {/* ------------------------------------------------ charts + leaders */}
            <div className="grid gap-3 lg:grid-cols-5">
                <Panel
                    className="lg:col-span-3"
                    title="Output by operation"
                    subtitle="Pieces handled this week"
                    data-testid="operation-stats-chart"
                >
                    {opStats.length > 0 ? (
                        <ResponsiveContainer width="100%" height={272}>
                            <BarChart data={opStats} barCategoryGap="22%"
                                margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="2 4" stroke="#e5eaf2" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: '#64748b' }}
                                    axisLine={false} tickLine={false} interval={0} height={40}
                                    angle={opStats.length > 4 ? -18 : 0}
                                    textAnchor={opStats.length > 4 ? 'end' : 'middle'} />
                                <YAxis tick={{ fontSize: 10.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
                                <Tooltip cursor={{ fill: 'rgba(41,79,150,0.05)' }} content={<ChartTip />} />
                                <Bar dataKey="total_qty" radius={[5, 5, 0, 0]} name="Quantity"
                                    animationDuration={620} animationEasing="ease-out">
                                    {opStats.map((entry, i) => (
                                        <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyState compact icon={Layers} title="No production this week"
                            message="Once entries are recorded for the current week they appear here." />
                    )}
                </Panel>

                <Panel
                    className="lg:col-span-2"
                    title="Top earners this week"
                    subtitle="Gross piece-rate earnings"
                    bodyClass="p-2"
                    data-testid="top-operators-card"
                >
                    {topOps.length > 0 ? (
                        <div className="stagger-fast">
                            {topOps.map((op, i) => (
                                <div key={op.operator_id} style={{ '--i': i }}
                                    className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5
                                        transition-colors duration-150 hover:bg-slate-50">
                                    {/* subtle proportional bar behind each row */}
                                    <span className="bar-grow absolute inset-y-0 left-0 -z-0 bg-brand/5"
                                        style={{ width: `${(op.total_earnings / maxEarn) * 100}%` }} />
                                    <div className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold
                                        ${i === 0 ? 'bg-amber-100 text-amber-700'
                                            : i === 1 ? 'bg-slate-200 text-slate-600'
                                                : i === 2 ? 'bg-orange-100 text-orange-700'
                                                    : 'bg-slate-100 text-slate-400'}`}>
                                        {i === 0 ? <Trophy size={11} /> : i + 1}
                                    </div>
                                    <div className="relative min-w-0 flex-1">
                                        <p className="truncate text-[12.5px] font-medium text-slate-800">
                                            {op.operator_name}
                                            <span className="ml-1 font-mono text-[10px] text-slate-400">{op.operator_code}</span>
                                        </p>
                                    </div>
                                    <span className="tnum relative text-[11px] text-muted-foreground">{num(op.total_qty)} pcs</span>
                                    <span className="tnum relative w-[74px] text-right text-[12.5px] font-semibold text-slate-900">
                                        {inr0(op.total_earnings)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState compact icon={Users} title="No operator activity"
                            message="Earnings appear here as production is entered." />
                    )}
                </Panel>
            </div>
        </div>
    );
}
