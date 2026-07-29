import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, Eye, Trash2, Lock, Unlock, Package, Search, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
    PageHeader, Panel, StatCard, EmptyState, Meter, Pill, SkeletonRows, num, inr, FieldLabel,
} from '../components/ui/primitives';

const inr0 = (n) => (Number(n) || 0).toLocaleString('en-IN',
    { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function LotsPage() {
    const [lots, setLots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reasonDialog, setReasonDialog] = useState(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const load = () => {
        setLoading(true);
        api.get('/lots')
            .then(r => setLots(r.data))
            .catch(() => toast.error('Could not load lots'))
            .finally(() => setLoading(false));
    };
    useEffect(() => { load(); }, []);

    const handleDelete = async (lot) => {
        if (!window.confirm(`Delete lot ${lot.lot_number}? This cannot be undone.`)) return;
        try {
            await api.delete(`/lots/${lot.id}`);
            toast.success(`${lot.lot_number} deleted`);
            load();
        } catch (err) {
            // the API refuses when production exists, so surface exactly why
            toast.error(err.response?.data?.detail || 'Could not delete lot');
        }
    };

    const handleClose = async (lot) => {
        setBusy(true);
        try {
            await api.post(`/lots/${lot.id}/close`, { reason: reason || 'Completed' });
            toast.success(`${lot.lot_number} closed`);
            setReasonDialog(null); setReason(''); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
        finally { setBusy(false); }
    };

    const handleReopen = async (lot) => {
        if (!reason.trim()) return toast.error('A reason is required to reopen a lot');
        setBusy(true);
        try {
            await api.post(`/lots/${lot.id}/reopen`, { reason });
            toast.success(`${lot.lot_number} reopened`);
            setReasonDialog(null); setReason(''); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
        finally { setBusy(false); }
    };

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return lots.filter(l => {
            if (filter === 'active' && l.status !== 'active') return false;
            if (filter === 'closed' && l.status === 'active') return false;
            if (!q) return true;
            return `${l.lot_number} ${l.style_name}`.toLowerCase().includes(q);
        });
    }, [lots, query, filter]);

    const totals = useMemo(() => ({
        active: lots.filter(l => l.status === 'active').length,
        planned: lots.reduce((s, l) => s + (l.total_planned_qty || 0), 0),
        produced: lots.reduce((s, l) => s + (l.total_produced_qty || 0), 0),
        cost: lots.reduce((s, l) => s + (l.total_labour_cost || 0), 0),
    }), [lots]);

    return (
        <div className="space-y-4" data-testid="lots-page">
            <PageHeader
                title="Lots"
                subtitle="Production orders — planned quantities, progress and labour cost"
                icon={Package}
                actions={isAdmin && (
                    <Button onClick={() => navigate('/lots/new')} data-testid="create-lot-button">
                        <Plus size={15} /> Create lot
                    </Button>
                )}
            />

            {!loading && lots.length > 0 && (
                <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard i={0} label="Active lots" value={totals.active} icon={Package} tone="brand"
                        sub={`${lots.length} total`} />
                    <StatCard i={1} label="Planned" value={totals.planned} tone="slate" sub="pieces ordered" />
                    <StatCard i={2} label="Completed" value={totals.produced} tone="leaf"
                        sub="through every operation" />
                    <StatCard i={3} label="Labour cost" value={totals.cost} format={inr0} tone="amber"
                        sub="booked across all operations" />
                </div>
            )}

            <Panel bodyClass="p-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Search lot number or style" className="h-8 pl-8 text-[12.5px]" />
                    </div>
                    <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                        {[['all', 'All'], ['active', 'Active'], ['closed', 'Closed']].map(([k, lbl]) => (
                            <button key={k} onClick={() => setFilter(k)}
                                className={`press cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors
                                    ${filter === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
                                {lbl}
                            </button>
                        ))}
                    </div>
                    <span className="tnum ml-auto text-[11.5px] text-muted-foreground">
                        {filtered.length} of {lots.length}
                    </span>
                </div>

                {loading ? (
                    <SkeletonRows rows={6} cols={6} />
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={Package}
                        title={lots.length === 0 ? 'No lots yet' : 'Nothing matches that filter'}
                        message={lots.length === 0
                            ? 'A lot holds the colour/size quantities and the operations with their piece rates.'
                            : 'Try a different search term or switch the status filter.'}
                        action={lots.length === 0 && isAdmin && (
                            <Button onClick={() => navigate('/lots/new')}><Plus size={14} /> Create the first lot</Button>
                        )}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="border-b border-border bg-slate-50/90">
                                    {['Lot', 'Style', 'Schedule', 'Planned', 'Progress', 'Status', ''].map((h, i) => (
                                        <th key={h + i}
                                            className={`whitespace-nowrap px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground
                                                ${h === 'Planned' ? 'text-right' : i === 6 ? 'text-right' : 'text-left'}`}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="stagger-fast">
                                {filtered.map((lot, i) => {
                                    const slowest = (lot.operation_progress || [])
                                        .slice().sort((a, b) => a.produced_qty - b.produced_qty)[0];
                                    return (
                                        <tr key={lot.id} style={{ '--i': i }}
                                            className="border-b border-border/60 transition-colors duration-150 hover:bg-brand-50/50"
                                            data-testid={`lot-row-${lot.id}`}>
                                            <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[12px] font-semibold text-brand">
                                                {lot.lot_number}
                                            </td>
                                            <td className="px-2.5 py-2 font-medium text-slate-800">{lot.style_name}</td>
                                            <td className="tnum whitespace-nowrap px-2.5 py-2 text-[11.5px] text-muted-foreground">
                                                {lot.start_date} → {lot.target_end_date}
                                            </td>
                                            <td className="tnum px-2.5 py-2 text-right text-slate-700">
                                                {num(lot.total_planned_qty)}
                                            </td>
                                            <td className="px-2.5 py-2">
                                                <Meter value={lot.progress} className="min-w-[130px]" />
                                                <p className="tnum mt-0.5 text-[10.5px] text-slate-400">
                                                    {num(lot.total_produced_qty)}/{num(lot.total_planned_qty)}
                                                    {slowest && lot.progress < 100 && (
                                                        <span className="ml-1.5">· slowest: {slowest.operation_name}</span>
                                                    )}
                                                </p>
                                            </td>
                                            <td className="px-2.5 py-2">
                                                <Pill tone={lot.status === 'active' ? 'green' : 'slate'}
                                                    data-testid={`status-${lot.id}`}>
                                                    {lot.status === 'active' ? 'Active' : 'Closed'}
                                                </Pill>
                                            </td>
                                            <td className="px-2.5 py-2 text-right">
                                                <div className="flex justify-end gap-0.5">
                                                    {isAdmin && (
                                                        <Button variant="ghost" size="iconSm" title="View / edit"
                                                            onClick={() => navigate(`/lots/${lot.id}`)}
                                                            data-testid={`edit-lot-${lot.id}`}>
                                                            <Eye size={13} />
                                                        </Button>
                                                    )}
                                                    {isAdmin && lot.status === 'active' && (
                                                        <Button variant="ghost" size="iconSm" title="Close lot"
                                                            className="text-amber-600 hover:bg-amber-50"
                                                            onClick={() => { setReasonDialog({ lot, action: 'close' }); setReason(''); }}
                                                            data-testid={`close-lot-${lot.id}`}>
                                                            <Lock size={13} />
                                                        </Button>
                                                    )}
                                                    {isAdmin && lot.status === 'completed' && (
                                                        <Button variant="ghost" size="iconSm" title="Reopen lot"
                                                            className="text-brand hover:bg-brand-50"
                                                            onClick={() => { setReasonDialog({ lot, action: 'reopen' }); setReason(''); }}
                                                            data-testid={`reopen-lot-${lot.id}`}>
                                                            <Unlock size={13} />
                                                        </Button>
                                                    )}
                                                    {isAdmin && (
                                                        <Button variant="ghost" size="iconSm" title="Delete lot"
                                                            className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                            onClick={() => handleDelete(lot)}
                                                            data-testid={`delete-lot-${lot.id}`}>
                                                            <Trash2 size={13} />
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <Dialog open={!!reasonDialog} onOpenChange={() => setReasonDialog(null)}>
                <DialogContent className="sm:max-w-md" data-testid="lot-reason-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">
                            {reasonDialog?.action === 'close' ? 'Close' : 'Reopen'} {reasonDialog?.lot?.lot_number}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 py-1">
                        {reasonDialog?.action === 'close' ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 ring-1 ring-inset ring-amber-200">
                                Closing stops any further production entry against this lot. It can be reopened later.
                            </p>
                        ) : (
                            <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[12px] text-brand-700 ring-1 ring-inset ring-brand/20">
                                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                Reopening allows entries to be added again. The reason is recorded in the audit trail.
                            </p>
                        )}
                        <div>
                            <Label className="mb-1 block">
                                <FieldLabel required={reasonDialog?.action === 'reopen'}>
                                    {reasonDialog?.action === 'reopen' ? 'Reason for reopening' : 'Reason (optional)'}
                                </FieldLabel>
                            </Label>
                            <Input value={reason} onChange={e => setReason(e.target.value)}
                                placeholder="e.g. short shipment, rework required"
                                data-testid="lot-reason-input" autoFocus />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReasonDialog(null)}>Cancel</Button>
                        <Button
                            loading={busy}
                            variant={reasonDialog?.action === 'close' ? 'default' : 'default'}
                            onClick={() => reasonDialog?.action === 'close'
                                ? handleClose(reasonDialog.lot)
                                : handleReopen(reasonDialog.lot)}
                            data-testid="confirm-lot-action">
                            {reasonDialog?.action === 'close' ? 'Close lot' : 'Reopen lot'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
