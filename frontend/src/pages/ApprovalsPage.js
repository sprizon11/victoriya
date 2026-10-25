import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ShieldCheck, Check, X } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, SkeletonRows, FieldLabel } from '../components/ui/primitives';

const TONE = { pending: 'amber', approved: 'green', rejected: 'rose', expired: 'slate', cancelled: 'slate', applying: 'amber' };

const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const sizesLine = (sq) => Object.entries(sq || {}).map(([k, v]) => `${k}: ${v}`).join('  ·  ') || '—';

/** Side-by-side "what it is now" vs "what is being asked for". */
function Change({ item }) {
    const snap = item.snapshot;
    if (item.type === 'production_edit') {
        return (
            <div className="grid gap-2 sm:grid-cols-2" data-testid={`approval-change-${item.id}`}>
                <div className="rounded-md bg-slate-50 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Now</p>
                    <p className="tnum text-[13px] text-slate-700">{snap ? sizesLine(snap.size_quantities) : 'not recorded (older request)'}</p>
                    {snap && <p className="text-[11px] text-slate-400">{snap.total_quantity} pcs</p>}
                </div>
                <div className="rounded-md bg-emerald-50/70 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Requested</p>
                    <p className="tnum text-[13px] text-slate-800">{sizesLine(item.payload?.size_quantities)}</p>
                    <p className="text-[11px] text-slate-400">
                        {Object.values(item.payload?.size_quantities || {}).reduce((a, b) => a + (+b || 0), 0)} pcs
                    </p>
                </div>
            </div>
        );
    }
    if (item.type === 'production_delete' && snap) {
        return (
            <div className="rounded-md bg-rose-50/70 p-2.5" data-testid={`approval-change-${item.id}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-600">Will be deleted</p>
                <p className="tnum text-[13px] text-slate-800">{sizesLine(snap.size_quantities)} ({snap.total_quantity} pcs)</p>
            </div>
        );
    }
    if (item.auto && (item.payload?.before || item.payload?.after)) {
        return (
            <div className="grid gap-2 sm:grid-cols-2 text-[11.5px]">
                <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2">{JSON.stringify(item.payload.before, null, 1)}</pre>
                <pre className="whitespace-pre-wrap break-words rounded-md bg-emerald-50/70 p-2">{JSON.stringify(item.payload.after, null, 1)}</pre>
            </div>
        );
    }
    return null;
}

function Card({ item, labels, isAdmin, me, onDecide, busy }) {
    const [note, setNote] = useState('');
    const mine = item.requested_by === me;
    return (
        <article className="rounded-xl border border-border bg-card p-3.5 shadow-xs" data-testid={`approval-${item.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">{labels[item.type] || item.type}</p>
                    <p className="break-words text-[12px] text-slate-500">{item.entity_label}</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {item.auto && <Pill tone="slate">auto</Pill>}
                    <Pill tone={TONE[item.status] || 'slate'}>{item.status}</Pill>
                </div>
            </div>
            <p className="mt-1 text-[11.5px] text-slate-400">
                {item.requested_by_name} · {when(item.requested_at)}
                {item.reviewed_by_name && item.status !== 'pending' && ` · decided by ${item.reviewed_by_name} ${when(item.reviewed_at)}`}
            </p>
            {item.summary && <p className="mt-1.5 text-[12.5px] text-slate-600">{item.summary}</p>}
            {item.reason && <p className="mt-1.5 text-[12.5px] text-slate-700"><span className="text-slate-400">Reason: </span>{item.reason}</p>}
            <div className="mt-2.5"><Change item={item} /></div>
            {item.review_note && <p className="mt-2 text-[12px] text-slate-600"><span className="text-slate-400">Note: </span>{item.review_note}</p>}
            {item.apply_error && (
                <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800" role="alert">{item.apply_error}</p>
            )}
            {item.status === 'pending' && (isAdmin || mine) && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    {isAdmin && (
                        <div className="min-w-[200px] flex-1">
                            <label><FieldLabel>Note (required to reject)</FieldLabel>
                                <Input className="mt-1 h-8" value={note} onChange={e => setNote(e.target.value)}
                                    data-testid={`approval-note-${item.id}`} /></label>
                        </div>
                    )}
                    {isAdmin && (
                        <>
                            <Button size="sm" disabled={busy} onClick={() => onDecide(item, 'approve', note)}
                                data-testid={`approval-approve-${item.id}`}><Check size={13} /> Approve</Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(item, 'reject', note)}
                                data-testid={`approval-reject-${item.id}`}><X size={13} /> Reject</Button>
                        </>
                    )}
                    {mine && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(item, 'cancel', '')}
                            data-testid={`approval-cancel-${item.id}`}>Cancel request</Button>
                    )}
                </div>
            )}
        </article>
    );
}

export default function ApprovalsPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const tabs = isAdmin ? [['pending', 'Pending'], ['mine', 'My requests'], ['history', 'History']] : [['mine', 'My requests']];
    const [tab, setTab] = useState(tabs[0][0]);
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], pages: 1, total: 0, labels: {} });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        const p = new URLSearchParams({ page, page_size: 25 });
        if (tab === 'pending') p.set('status', 'pending');
        if (tab === 'mine') p.set('mine', 'true');
        api.get(`/approvals?${p}`)
            .then(r => setData(tab === 'history' ? { ...r.data, items: r.data.items.filter(i => i.status !== 'pending') } : r.data))
            .catch(() => toast.error('Could not load approvals'))
            .finally(() => setLoading(false));
    }, [tab, page]);
    useEffect(() => { load(); }, [load]);

    const decide = async (item, action, note) => {
        if (action === 'reject' && !note.trim()) return toast.error('Add a note explaining the rejection');
        setBusy(true);
        try {
            await api.post(`/approvals/${item.id}/${action}`, action === 'cancel' ? undefined : { note });
            toast.success({ approve: 'Approved and applied', reject: 'Rejected', cancel: 'Request cancelled' }[action]);
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Could not complete that', { duration: 7000 });
        } finally { setBusy(false); load(); window.dispatchEvent(new Event('approvals-changed')); }
    };

    return (
        <div className="space-y-4" data-testid="approvals-page">
            <PageHeader title="Approvals" icon={ShieldCheck}
                subtitle={isAdmin ? 'Requests that need an administrator, and a record of sensitive actions'
                    : 'Corrections you have asked an administrator to approve'} />
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 w-fit" role="tablist">
                {tabs.map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }}
                        data-testid={`approvals-tab-${k}`}
                        className={`press cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium transition-colors
                            ${tab === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {loading ? <Panel bodyClass="p-0"><SkeletonRows rows={4} cols={3} /></Panel>
                : data.items.length === 0 ? (
                    <Panel bodyClass="p-0"><EmptyState icon={ShieldCheck} title="Nothing here"
                        message={tab === 'pending' ? 'No requests are waiting for you.' : 'No requests yet.'} /></Panel>
                ) : (
                    <div className="space-y-3">
                        {data.items.map(item => (
                            <Card key={item.id} item={item} labels={data.labels || {}} isAdmin={isAdmin} me={user?.id}
                                onDecide={decide} busy={busy} />
                        ))}
                    </div>
                )}
            <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="text-[12px] text-muted-foreground">Page {page} of {data.pages}</span>
                <Button variant="outline" size="sm" disabled={page >= data.pages || loading} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
        </div>
    );
}
