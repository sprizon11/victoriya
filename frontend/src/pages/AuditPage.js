import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { History, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, SkeletonRows, num, FieldLabel } from '../components/ui/primitives';

const EMPTY = { q: '', user: '', action: '', entity_type: '', outcome: '', date_from: '', date_to: '' };
const ENTITY_TYPES = ['lot', 'production', 'operator', 'operation', 'color', 'size_chart', 'week',
    'advance', 'user', 'setting', 'approval', 'operator_group', 'operation_group', 'system'];

const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
};

function Diff({ row }) {
    const keys = Array.from(new Set([...Object.keys(row.before || {}), ...Object.keys(row.after || {})]));
    return (
        <div className="grid gap-3 px-3 py-3 text-[12px] md:grid-cols-2" data-testid={`audit-diff-${row.id}`}>
            <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Before</p>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-rose-50/60 p-2 text-slate-700">
                    {row.before ? JSON.stringify(row.before, null, 2) : '—'}
                </pre>
            </div>
            <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">After</p>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-emerald-50/60 p-2 text-slate-700">
                    {row.after ? JSON.stringify(row.after, null, 2) : '—'}
                </pre>
            </div>
            <p className="text-[11px] text-slate-400 md:col-span-2">
                {keys.length > 0 && `Changed: ${keys.join(', ')} · `}From {row.ip || 'unknown IP'}
                {row.approval_id && ` · approval ${row.approval_id}`}
            </p>
        </div>
    );
}

export default function AuditPage() {
    const [filters, setFilters] = useState(EMPTY);
    const [applied, setApplied] = useState(EMPTY);
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0, pages: 1 });
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(null);

    const params = useCallback((extra = {}) => {
        const p = new URLSearchParams();
        Object.entries({ ...applied, ...extra }).forEach(([k, v]) => { if (v) p.append(k, v); });
        return p;
    }, [applied]);

    useEffect(() => {
        setLoading(true);
        api.get(`/audit-logs?${params({ page, page_size: 50 }).toString()}`)
            .then(r => setData(r.data))
            .catch(() => toast.error('Could not load the activity log'))
            .finally(() => setLoading(false));
    }, [params, page]);

    const apply = (e) => { e.preventDefault(); setPage(1); setApplied(filters); setOpen(null); };
    const reset = () => { setFilters(EMPTY); setApplied(EMPTY); setPage(1); setOpen(null); };
    const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

    const exportCsv = async () => {
        try { await downloadFile(`/api/audit-logs/export?${params().toString()}`, 'activity_log.csv'); }
        catch { toast.error('Export failed'); }
    };

    const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-[13px]';

    return (
        <div className="space-y-4" data-testid="audit-page">
            <PageHeader title="Activity log" icon={History}
                subtitle="Every change made in the app: who, what, when. Entries cannot be edited or deleted."
                actions={<Button variant="outline" onClick={exportCsv} data-testid="audit-export"><Download size={14} /> Export CSV</Button>} />

            <Panel bodyClass="p-3">
                <form onSubmit={apply} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-7" data-testid="audit-filters">
                    <div className="col-span-2 lg:col-span-2">
                        <label><FieldLabel>Search</FieldLabel>
                            <Input className="mt-1 h-9" value={filters.q} onChange={set('q')} placeholder="summary, label, user…" data-testid="audit-q" /></label>
                    </div>
                    <div><label><FieldLabel>User</FieldLabel>
                        <Input className="mt-1 h-9" value={filters.user} onChange={set('user')} placeholder="name" data-testid="audit-user" /></label></div>
                    <div><label><FieldLabel>Action starts with</FieldLabel>
                        <Input className="mt-1 h-9" value={filters.action} onChange={set('action')} placeholder="lots." data-testid="audit-action" /></label></div>
                    <div><label><FieldLabel>Entity</FieldLabel>
                        <select className={selectCls} value={filters.entity_type} onChange={set('entity_type')} data-testid="audit-entity">
                            <option value="">All</option>{ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select></label></div>
                    <div><label><FieldLabel>Outcome</FieldLabel>
                        <select className={selectCls} value={filters.outcome} onChange={set('outcome')} data-testid="audit-outcome">
                            <option value="">All</option><option value="ok">OK</option><option value="denied">Denied</option>
                        </select></label></div>
                    <div><label><FieldLabel>From</FieldLabel>
                        <Input type="date" className="mt-1 h-9" value={filters.date_from} onChange={set('date_from')} data-testid="audit-from" /></label></div>
                    <div><label><FieldLabel>To</FieldLabel>
                        <Input type="date" className="mt-1 h-9" value={filters.date_to} onChange={set('date_to')} data-testid="audit-to" /></label></div>
                    <div className="col-span-2 flex items-end gap-2 md:col-span-2">
                        <Button type="submit" data-testid="audit-apply">Apply</Button>
                        <Button type="button" variant="outline" onClick={reset} data-testid="audit-reset">Reset</Button>
                    </div>
                </form>
            </Panel>

            <Panel bodyClass="p-0">
                {loading ? <SkeletonRows rows={8} cols={5} /> : data.items.length === 0 ? (
                    <EmptyState icon={History} title="No matching activity" message="Try widening the filters." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12.5px]">
                            <thead>
                                <tr className="border-b border-border bg-slate-50/90">
                                    {['', 'When', 'User', 'Action', 'What', 'Result'].map(h => (
                                        <th key={h} className="whitespace-nowrap px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map(row => {
                                    const expandable = row.before || row.after || row.ip;
                                    const isOpen = open === row.id;
                                    return (
                                        <Fragment key={row.id}>
                                            <tr className="border-b border-border/60 hover:bg-brand-50/40" data-testid={`audit-row-${row.id}`}>
                                                <td className="w-6 px-2">
                                                    {expandable && (
                                                        <button onClick={() => setOpen(isOpen ? null : row.id)} aria-label={isOpen ? 'Hide detail' : 'Show detail'}
                                                            aria-expanded={isOpen} className="cursor-pointer text-slate-400 hover:text-slate-700">
                                                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="tnum whitespace-nowrap px-2.5 py-2 text-slate-500">{when(row.at)}</td>
                                                <td className="whitespace-nowrap px-2.5 py-2">{row.user_name || '—'}
                                                    <span className="ml-1 text-[10.5px] capitalize text-slate-400">{row.role?.replace('_', ' ')}</span></td>
                                                <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[11.5px] text-brand">{row.action}</td>
                                                <td className="px-2.5 py-2">
                                                    <span className="font-medium text-slate-800">
                                                        {row.entity_type === 'lot' && row.entity_id
                                                            ? <Link className="hover:underline" to={`/lots/${row.entity_id}`}>{row.entity_label || row.entity_id}</Link>
                                                            : (row.entity_label || row.entity_type)}
                                                    </span>
                                                    <span className="block text-[11.5px] text-slate-500">{row.summary}</span>
                                                </td>
                                                <td className="px-2.5 py-2"><Pill tone={row.outcome === 'ok' ? 'green' : 'rose'}>{row.outcome}</Pill></td>
                                            </tr>
                                            {isOpen && (<tr className="border-b border-border/60 bg-slate-50/50"><td colSpan={6}><Diff row={row} /></td></tr>)}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
                    <span className="tnum">{num(data.total)} entries · page {data.page || page} of {data.pages}</span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} data-testid="audit-prev">Previous</Button>
                        <Button variant="outline" size="sm" disabled={page >= data.pages || loading} onClick={() => setPage(page + 1)} data-testid="audit-next">Next</Button>
                    </div>
                </div>
            </Panel>
        </div>
    );
}
