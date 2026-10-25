import { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
    Save, List, ShieldAlert, Pencil, MessageSquare, Trash2, ClipboardList,
    CalendarDays, Info, History,
} from 'lucide-react';
import {
    PageHeader, Panel, EmptyState, Pill, SkeletonRows, inr, num, FieldLabel,
} from '../components/ui/primitives';

export default function ProductionEntryPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const canViewFinancial = isAdmin || user?.can_view_financial === true;
    // The API only lets administrators change entries directly (the per-user
    // can_edit/can_delete flags don't override that), so everyone else goes
    // through an approval request instead of a button that would answer 403.
    const canEdit = isAdmin;
    const canDelete = isAdmin;

    const [weeks, setWeeks] = useState([]);
    const [lots, setLots] = useState([]);
    const [allLots, setAllLots] = useState([]);
    const [weekId, setWeekId] = useState('');
    const [lotId, setLotId] = useState('');
    const [selectedLot, setSelectedLot] = useState(null);
    const [operationId, setOperationId] = useState('');
    const [color, setColor] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [matrix, setMatrix] = useState({});
    const [tracking, setTracking] = useState([]);
    const [saving, setSaving] = useState(false);
    const [recentEntries, setRecentEntries] = useState([]);
    const [logEntries, setLogEntries] = useState([]);
    const [logLoading, setLogLoading] = useState(false);
    const [logFilters, setLogFilters] = useState({ lot_id: '', week: '', operator_id: '', operation_id: '' });
    const [operators, setOperators] = useState([]);
    const [operations, setOperations] = useState([]);
    const [editDialog, setEditDialog] = useState(null);
    const [editReason, setEditReason] = useState('');
    const [editMatrix, setEditMatrix] = useState({});
    const [editBusy, setEditBusy] = useState(false);

    useEffect(() => {
        api.get('/weeks').then(r => setWeeks(r.data)).catch(() => {});
        api.get('/lots?status=active').then(r => setLots(r.data)).catch(() => {});
        api.get('/lots').then(r => setAllLots(r.data)).catch(() => {});
        api.get('/operators').then(r => setOperators(r.data)).catch(() => {});
        api.get('/operations').then(r => setOperations(r.data)).catch(() => {});
    }, []);

    // Default to the week that contains today, so the floor supervisor is not
    // one wrong dropdown away from filing a day against the wrong week.
    useEffect(() => {
        if (weekId || weeks.length === 0) return;
        const today = new Date().toISOString().split('T')[0];
        const current = weeks.find(w => w.start_date <= today && w.end_date >= today);
        if (current) setWeekId(current.id);
    }, [weeks, weekId]);

    const handleLotChange = (id) => {
        setLotId(id);
        setSelectedLot(lots.find(l => l.id === id));
        setOperationId(''); setColor(''); setMatrix({});
    };

    const loadTracking = useCallback(async () => {
        if (!lotId || !operationId) { setTracking([]); return; }
        try {
            const r = await api.get(`/production/tracking/${lotId}?operation_id=${operationId}`);
            setTracking(r.data);
        } catch { /* tracking is advisory; the server still enforces the limit */ }
    }, [lotId, operationId]);
    useEffect(() => { loadTracking(); }, [loadTracking]);

    const loadRecentEntries = useCallback(async () => {
        if (!lotId || !weekId) { setRecentEntries([]); return; }
        const week = weeks.find(w => w.id === weekId);
        if (!week) return;
        try {
            const r = await api.get(`/production?lot_id=${lotId}&week=${week.week_number}&year=${week.year}`);
            setRecentEntries(r.data);
        } catch { /* non-fatal */ }
    }, [lotId, weekId, weeks]);
    useEffect(() => { loadRecentEntries(); }, [loadRecentEntries]);

    const loadLog = async () => {
        setLogLoading(true);
        const params = new URLSearchParams();
        if (logFilters.lot_id && logFilters.lot_id !== 'all') params.append('lot_id', logFilters.lot_id);
        if (logFilters.week) params.append('week', logFilters.week);
        if (logFilters.operator_id && logFilters.operator_id !== 'all') params.append('operator_id', logFilters.operator_id);
        if (logFilters.operation_id && logFilters.operation_id !== 'all') params.append('operation_id', logFilters.operation_id);
        try {
            const r = await api.get(`/production?${params.toString()}`);
            setLogEntries(r.data);
        } catch { toast.error('Could not load the entry log'); }
        finally { setLogLoading(false); }
    };

    /* ------------------------------------------------------------ editing */

    // Every size on the lot, not just the ones already stored. Zero-quantity
    // sizes are stripped when an entry is saved, so without this a size typed
    // as 0 by mistake could never be corrected through the UI.
    const editSizes = useMemo(() => {
        if (!editDialog) return [];
        const lot = allLots.find(l => l.id === editDialog.lot_id);
        const fromLot = lot?.sizes || [];
        const fromEntry = Object.keys(editDialog.size_quantities || {});
        return fromLot.length ? Array.from(new Set([...fromLot, ...fromEntry])) : fromEntry;
    }, [editDialog, allLots]);

    const openEditDialog = (entry) => {
        setEditDialog(entry);
        setEditMatrix({ ...(entry.size_quantities || {}) });
        setEditReason('');
    };

    const collectEditQuantities = () => {
        const out = {};
        for (const sz of editSizes) {
            const v = parseInt(editMatrix[sz]) || 0;
            if (v > 0) out[sz] = v;
        }
        return out;
    };

    const handleAdminEdit = async () => {
        const newSq = collectEditQuantities();
        if (Object.keys(newSq).length === 0) {
            return toast.error('Enter at least one quantity, or delete the entry instead');
        }
        setEditBusy(true);
        try {
            await api.put(`/production/${editDialog.id}`, {
                size_quantities: newSq, reason: editReason,
            });
            toast.success('Entry updated — change recorded in the audit trail');
            setEditDialog(null); setEditMatrix({});
            loadLog(); loadRecentEntries(); loadTracking();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Could not update entry');
        } finally { setEditBusy(false); }
    };

    const handleRequestEdit = async () => {
        if (!editReason.trim()) return toast.error('Please give a reason for the change');
        const newSq = collectEditQuantities();
        if (Object.keys(newSq).length === 0) {
            return toast.error('Enter the corrected quantities you are requesting');
        }
        setEditBusy(true);
        try {
            // The proposed quantities must travel with the request. Without them
            // an admin could "approve" it and nothing would actually change.
            await api.post('/approvals', {
                type: 'production_edit',
                entity_id: editDialog.id,
                reason: editReason,
                payload: { size_quantities: newSq },
            });
            toast.success('Request submitted for admin approval');
            setEditDialog(null); setEditReason(''); setEditMatrix({});
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Could not submit request');
        } finally { setEditBusy(false); }
    };

    const handleRequestDelete = async (entry) => {
        const reason = window.prompt(
            `Why should ${entry.operator_name}'s entry of ${entry.total_quantity} pcs on ${entry.date} be deleted?`);
        if (reason === null) return;
        if (!reason.trim()) return toast.error('A reason is required');
        try {
            await api.post('/approvals', { type: 'production_delete', entity_id: entry.id, reason: reason.trim() });
            toast.success('Delete request submitted for admin approval');
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not submit request'); }
    };

    const handleDeleteEntry = async (entry) => {
        if (!window.confirm(`Delete ${entry.operator_name}'s entry of ${entry.total_quantity} pcs on ${entry.date}?`)) return;
        try {
            await api.delete(`/production/${entry.id}`);
            toast.success('Entry deleted');
            loadLog(); loadTracking(); loadRecentEntries();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    /* ------------------------------------------------------------- matrix */

    const selectedOp = selectedLot?.operations?.find(o => o.operation_id === operationId);
    const assignedOperators = selectedOp?.operators || [];
    const sizes = selectedLot?.sizes || [];
    const colorTracking = tracking.find(t => t.name === color);

    const getBalance = useCallback((size) => {
        if (!colorTracking) return null;
        const st = colorTracking.sizes?.find(s => s.size === size);
        return st ? st.balance : null;
    }, [colorTracking]);

    const getNewTotal = useCallback((size) => {
        let total = 0;
        Object.values(matrix).forEach(ops => { total += parseInt(ops[size]) || 0; });
        return total;
    }, [matrix]);

    const updateCell = (opId, size, val) => {
        const numVal = parseInt(val) || 0;
        const bal = getBalance(size);
        const otherTotal = Object.entries(matrix).reduce((sum, [id, ops]) =>
            id === opId ? sum : sum + (parseInt(ops[size]) || 0), 0);
        if (bal !== null && numVal + otherTotal > bal) {
            const maxAllowed = Math.max(0, bal - otherTotal);
            toast.error(`${size}: only ${maxAllowed} left against the plan`);
            setMatrix(prev => ({ ...prev, [opId]: { ...(prev[opId] || {}), [size]: String(maxAllowed) } }));
            return;
        }
        setMatrix(prev => ({ ...prev, [opId]: { ...(prev[opId] || {}), [size]: val } }));
    };

    const hasExceeded = sizes.some(s => {
        const b = getBalance(s);
        return b !== null && getNewTotal(s) > b;
    });

    const totalPieces = Object.values(matrix).reduce(
        (sum, ops) => sum + Object.values(ops).reduce((s, q) => s + (parseInt(q) || 0), 0), 0);

    const handleSubmit = async () => {
        if (!weekId) return toast.error('Select a week');
        if (!lotId) return toast.error('Select a lot');
        if (!operationId) return toast.error('Select an operation');
        if (!color) return toast.error('Select a colour');
        if (hasExceeded) return toast.error('Reduce quantities — the plan would be exceeded');

        const entries = [];
        for (const [opId, szs] of Object.entries(matrix)) {
            const nonZero = {};
            for (const [sz, qty] of Object.entries(szs)) {
                const q = parseInt(qty) || 0;
                if (q > 0) nonZero[sz] = q;
            }
            if (Object.keys(nonZero).length > 0) entries.push({ operator_id: opId, sizes: nonZero });
        }
        if (entries.length === 0) return toast.error('Enter at least one quantity');

        setSaving(true);
        try {
            const r = await api.post('/production/batch', {
                week_id: weekId, lot_id: lotId, operation_id: operationId, color, date, entries,
            });
            const d = r.data;
            if (d.duplicates_skipped?.length > 0) {
                toast.warning(
                    `${d.saved} saved. Already recorded for ${date}: ${d.duplicates_skipped.join(', ')}`,
                    { duration: 7000 });
            } else {
                toast.success(`${d.saved} ${d.saved === 1 ? 'entry' : 'entries'} saved for ${date}`);
            }
            setMatrix({});
            loadTracking();
            loadRecentEntries();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Could not save entries', { duration: 7000 });
        } finally { setSaving(false); }
    };

    const selectClass = "mt-1";

    return (
        <div className="space-y-4" data-testid="production-entry-page">
            <PageHeader
                title="Production entry"
                subtitle="Record daily output per operator, by operation, colour and size"
                icon={ClipboardList}
            />

            <Tabs defaultValue="entry" className="w-full">
                <TabsList className="bg-slate-100">
                    <TabsTrigger value="entry" data-testid="tab-entry">New entry</TabsTrigger>
                    <TabsTrigger value="log" data-testid="tab-log">Entry log</TabsTrigger>
                </TabsList>

                {/* ============================================== NEW ENTRY */}
                <TabsContent value="entry" className="mt-3 space-y-3">
                    <Panel title="1 · Choose what you are recording" bodyClass="p-3.5">
                        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
                            <div>
                                <Label><FieldLabel required>Week</FieldLabel></Label>
                                <Select value={weekId} onValueChange={setWeekId}>
                                    <SelectTrigger className={selectClass} data-testid="prod-week">
                                        <SelectValue placeholder="Week" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {weeks.map(w => (
                                            <SelectItem key={w.id} value={w.id}>
                                                W{w.week_number} · {w.start_date} to {w.end_date}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel required>Lot</FieldLabel></Label>
                                <Select value={lotId} onValueChange={handleLotChange}>
                                    <SelectTrigger className={selectClass} data-testid="prod-lot">
                                        <SelectValue placeholder="Lot" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {lots.map(l => (
                                            <SelectItem key={l.id} value={l.id}>
                                                {l.lot_number} · {l.style_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel required>Operation</FieldLabel></Label>
                                <Select value={operationId} onValueChange={v => { setOperationId(v); setMatrix({}); }}>
                                    <SelectTrigger className={selectClass} data-testid="prod-operation">
                                        <SelectValue placeholder="Operation" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedLot?.operations?.map(o => (
                                            <SelectItem key={o.operation_id} value={o.operation_id}>
                                                {o.operation_name}{canViewFinancial && ` · ₹${o.rate}/pc`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel required>Colour</FieldLabel></Label>
                                <Select value={color} onValueChange={setColor}>
                                    <SelectTrigger className={selectClass} data-testid="prod-color">
                                        <SelectValue placeholder="Colour" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedLot?.colors?.map(c => (
                                            <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel required>Date</FieldLabel></Label>
                                <Input type="date" value={date} onChange={e => setDate(e.target.value)}
                                    className="mt-1 font-mono" data-testid="prod-date" />
                            </div>
                        </div>
                        <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                            <CalendarDays size={12} className="mt-0.5 shrink-0" />
                            Enter one day at a time. Each operator can have one entry per day for this
                            lot, operation and colour — every day of the week is recorded separately.
                        </p>
                    </Panel>

                    {colorTracking && (
                        <Panel
                            title={`Balance remaining — ${color}`}
                            subtitle={selectedOp?.operation_name}
                            bodyClass="p-0"
                            data-testid="live-tracking"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-[12px]">
                                    <thead>
                                        <tr className="bg-slate-50/90">
                                            <th className="border-b border-border px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Metric
                                            </th>
                                            {colorTracking.sizes?.map(s => (
                                                <th key={s.size} className="min-w-[54px] border-b border-l border-border px-2 py-1.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                                                    {s.size}
                                                </th>
                                            ))}
                                            <th className="border-b border-l border-border px-2.5 py-1.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                                                Total
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            ['Planned', 'planned', 'text-slate-600', 'total_planned'],
                                            ['Produced', 'produced', 'text-leaf', 'total_produced'],
                                            ['Balance', 'balance', 'text-amber-700', 'balance'],
                                        ].map(([label, key, tone, totalKey]) => (
                                            <tr key={key} className="border-b border-border/60 last:border-0">
                                                <td className={`px-2.5 py-1.5 font-medium ${tone}`}>{label}</td>
                                                {colorTracking.sizes?.map(s => (
                                                    <td key={s.size}
                                                        className={`tnum border-l border-border/60 px-2 py-1.5 text-center
                                                            ${key === 'balance' && s.balance <= 0
                                                                ? 'bg-rose-50 font-semibold text-rose-600' : tone}`}>
                                                        {num(s[key])}
                                                    </td>
                                                ))}
                                                <td className={`tnum border-l border-border/60 px-2.5 py-1.5 text-center font-semibold ${tone}`}>
                                                    {num(colorTracking[totalKey])}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    )}

                    {assignedOperators.length > 0 && sizes.length > 0 && color ? (
                        <Panel
                            title="2 · Enter quantities"
                            subtitle="Rows are the operators assigned to this operation"
                            bodyClass="p-0"
                            actions={
                                <div className="flex items-center gap-3 text-[12px]">
                                    <span className="text-muted-foreground">
                                        Total <span className="tnum font-semibold text-brand">{num(totalPieces)} pcs</span>
                                    </span>
                                    {canViewFinancial && selectedOp && (
                                        <span className="text-muted-foreground">
                                            Wages <span className="tnum font-semibold text-leaf">
                                                {inr(totalPieces * selectedOp.rate)}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            }
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-[13px]" data-testid="production-matrix">
                                    <thead>
                                        <tr className="bg-slate-50/90">
                                            <th className="sticky-col min-w-[165px] border-b border-border bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Operator
                                            </th>
                                            {sizes.map(s => {
                                                const bal = getBalance(s);
                                                const exceeded = bal !== null && getNewTotal(s) > bal;
                                                return (
                                                    <th key={s}
                                                        className={`min-w-[66px] border-b border-l border-border px-2 py-1.5 text-center text-[10px] font-semibold uppercase
                                                            ${exceeded ? 'bg-rose-50 text-rose-600' : 'text-muted-foreground'}`}>
                                                        {s}
                                                        {bal !== null && (
                                                            <div className={`tnum text-[9px] font-normal normal-case
                                                                ${bal <= 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                                                                {bal} left
                                                            </div>
                                                        )}
                                                    </th>
                                                );
                                            })}
                                            <th className="border-b border-l border-border px-3 py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                                                Total
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="stagger-fast">
                                        {assignedOperators.map((op, i) => {
                                            const rowTotal = sizes.reduce(
                                                (s, sz) => s + (parseInt(matrix[op.operator_id]?.[sz]) || 0), 0);
                                            return (
                                                <tr key={op.operator_id} style={{ '--i': i }}
                                                    className="border-b border-border/60 transition-colors hover:bg-brand-50/40">
                                                    <td className="sticky-col border-r border-border/60 bg-card px-3 py-1 text-[12.5px] font-medium text-slate-800">
                                                        {op.operator_name}
                                                        <span className="ml-1 font-mono text-[10px] text-slate-400">
                                                            {op.operator_code}
                                                        </span>
                                                    </td>
                                                    {sizes.map(sz => {
                                                        const bal = getBalance(sz);
                                                        const disabled = bal !== null && bal <= 0;
                                                        return (
                                                            <td key={sz}
                                                                className={`border-l border-border/60 p-0 ${disabled ? 'bg-slate-50' : ''}`}>
                                                                <input
                                                                    type="number" min="0" inputMode="numeric"
                                                                    className={`excel-input text-center ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                                                                    placeholder={disabled ? '—' : '·'}
                                                                    disabled={disabled}
                                                                    value={matrix[op.operator_id]?.[sz] || ''}
                                                                    onChange={e => updateCell(op.operator_id, sz, e.target.value)}
                                                                    data-testid={`cell-${op.operator_id}-${sz}`}
                                                                />
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="tnum border-l border-border/60 px-3 py-1 text-center font-semibold text-slate-700">
                                                        {rowTotal || <span className="text-slate-300">0</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {hasExceeded && (
                                <div className="animate-rise-sm flex items-center gap-2 border-t border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-700"
                                    data-testid="qty-exceeded-warning">
                                    <ShieldAlert size={14} />
                                    Blocked — the highlighted sizes would go over the planned quantity.
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2.5">
                                <p className="text-[11.5px] text-muted-foreground">
                                    Saving records <span className="tnum font-medium text-slate-700">{num(totalPieces)}</span> pieces on {date}
                                </p>
                                <Button onClick={handleSubmit} loading={saving} disabled={hasExceeded || totalPieces === 0}
                                    data-testid="submit-production">
                                    <Save size={14} /> {saving ? 'Saving…' : 'Save production'}
                                </Button>
                            </div>
                        </Panel>
                    ) : (
                        <Panel bodyClass="p-0">
                            <EmptyState
                                compact icon={ClipboardList}
                                title="Choose a lot, operation and colour"
                                message="The entry grid appears once you have picked all four above. Operators shown are those assigned to the chosen operation."
                            />
                        </Panel>
                    )}

                    {recentEntries.length > 0 && (
                        <Panel
                            title="Already recorded this week"
                            subtitle={`${recentEntries.length} entries for the selected lot`}
                            bodyClass="p-0"
                        >
                            <div className="max-h-[340px] overflow-auto">
                                <table className="w-full text-[12.5px]">
                                    <thead className="sticky top-0 z-10">
                                        <tr className="bg-slate-50/95 backdrop-blur">
                                            {['Date', 'Operation', 'Colour', 'Operator', 'Qty',
                                                ...(canViewFinancial ? ['Wages'] : []), 'By'].map((h, i) => (
                                                    <th key={h}
                                                        className={`whitespace-nowrap border-b border-border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground
                                                        ${h === 'Qty' || h === 'Wages' ? 'text-right' : 'text-left'}`}>
                                                        {h}
                                                    </th>
                                                ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recentEntries.slice(0, 40).map(e => (
                                            <tr key={e.id} className="border-b border-border/50 transition-colors hover:bg-brand-50/40">
                                                <td className="tnum whitespace-nowrap px-2.5 py-1.5 text-muted-foreground">{e.date}</td>
                                                <td className="px-2.5 py-1.5">{e.operation_name}</td>
                                                <td className="px-2.5 py-1.5">{e.color}</td>
                                                <td className="px-2.5 py-1.5">
                                                    {e.operator_name}
                                                    <span className="ml-1 font-mono text-[10px] text-slate-400">{e.operator_code}</span>
                                                </td>
                                                <td className="tnum px-2.5 py-1.5 text-right font-medium">{num(e.total_quantity)}</td>
                                                {canViewFinancial && (
                                                    <td className="tnum px-2.5 py-1.5 text-right text-leaf">{inr(e.total_earnings)}</td>
                                                )}
                                                <td className="px-2.5 py-1.5 text-[10.5px] text-slate-400">{e.entered_by_name}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    )}
                </TabsContent>

                {/* ================================================ ENTRY LOG */}
                <TabsContent value="log" className="mt-3 space-y-3">
                    <Panel title="Find entries" bodyClass="p-3.5">
                        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
                            <div>
                                <Label><FieldLabel>Lot</FieldLabel></Label>
                                <Select value={logFilters.lot_id} onValueChange={v => setLogFilters({ ...logFilters, lot_id: v })}>
                                    <SelectTrigger className={selectClass} data-testid="log-lot">
                                        <SelectValue placeholder="All lots" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All lots</SelectItem>
                                        {allLots.map(l => (
                                            <SelectItem key={l.id} value={l.id}>{l.lot_number} · {l.style_name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel>Week number</FieldLabel></Label>
                                <Input type="number" value={logFilters.week}
                                    onChange={e => setLogFilters({ ...logFilters, week: e.target.value })}
                                    className="mt-1 font-mono" placeholder="All" data-testid="log-week" />
                            </div>
                            <div>
                                <Label><FieldLabel>Operator</FieldLabel></Label>
                                <Select value={logFilters.operator_id} onValueChange={v => setLogFilters({ ...logFilters, operator_id: v })}>
                                    <SelectTrigger className={selectClass} data-testid="log-operator">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All operators</SelectItem>
                                        {operators.filter(o => o.active).map(o => (
                                            <SelectItem key={o.id} value={o.id}>{o.name} ({o.operator_code})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label><FieldLabel>Operation</FieldLabel></Label>
                                <Select value={logFilters.operation_id} onValueChange={v => setLogFilters({ ...logFilters, operation_id: v })}>
                                    <SelectTrigger className={selectClass} data-testid="log-operation">
                                        <SelectValue placeholder="All" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All operations</SelectItem>
                                        {operations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end">
                                <Button onClick={loadLog} loading={logLoading} className="w-full" data-testid="load-log">
                                    <List size={14} /> Load log
                                </Button>
                            </div>
                        </div>
                    </Panel>

                    {logLoading && <Panel bodyClass="p-0"><SkeletonRows rows={8} cols={7} /></Panel>}

                    {!logLoading && logEntries.length > 0 && (
                        <Panel title={`${logEntries.length} entries`} bodyClass="p-0">
                            <div className="overflow-x-auto">
                                <table className="w-full text-[12.5px]">
                                    <thead>
                                        <tr className="bg-slate-50/90">
                                            {['Date', 'Wk', 'Lot', 'Operation', 'Colour', 'Operator', 'Qty',
                                                ...(canViewFinancial ? ['Wages'] : []), 'Entered by', ''].map((h, i) => (
                                                    <th key={h + i}
                                                        className={`whitespace-nowrap border-b border-border px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground
                                                        ${h === 'Qty' || h === 'Wages' ? 'text-right' : 'text-left'}`}>
                                                        {h}
                                                    </th>
                                                ))}
                                        </tr>
                                    </thead>
                                    <tbody className="stagger-fast">
                                        {logEntries.map((e, i) => (
                                            <tr key={e.id} style={{ '--i': i }}
                                                className="border-b border-border/60 transition-colors hover:bg-brand-50/40"
                                                data-testid={`log-entry-${e.id}`}>
                                                <td className="tnum whitespace-nowrap px-2.5 py-1.5">{e.date}</td>
                                                <td className="tnum px-2.5 py-1.5 text-muted-foreground">W{e.week_number}</td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[11px] text-brand">{e.lot_number}</td>
                                                <td className="px-2.5 py-1.5">{e.operation_name}</td>
                                                <td className="px-2.5 py-1.5">{e.color}</td>
                                                <td className="whitespace-nowrap px-2.5 py-1.5">
                                                    {e.operator_name}
                                                    <span className="ml-1 font-mono text-[10px] text-slate-400">{e.operator_code}</span>
                                                </td>
                                                <td className="tnum px-2.5 py-1.5 text-right font-semibold">{num(e.total_quantity)}</td>
                                                {canViewFinancial && (
                                                    <td className="tnum px-2.5 py-1.5 text-right text-leaf">{inr(e.total_earnings)}</td>
                                                )}
                                                <td className="px-2.5 py-1.5 text-[10.5px] text-slate-400">
                                                    {e.entered_by_name}
                                                    {e.edit_history?.length > 0 && (
                                                        <Pill tone="amber" className="ml-1.5">
                                                            <History size={9} /> edited
                                                        </Pill>
                                                    )}
                                                </td>
                                                <td className="px-2.5 py-1.5 text-right">
                                                    <div className="flex justify-end gap-0.5">
                                                        {canEdit ? (
                                                            <Button variant="ghost" size="xs" className="text-brand"
                                                                onClick={() => openEditDialog(e)}
                                                                data-testid={`log-edit-${e.id}`}>
                                                                <Pencil size={11} /> Edit
                                                            </Button>
                                                        ) : (
                                                            <Button variant="ghost" size="xs" className="text-amber-600"
                                                                onClick={() => openEditDialog(e)}
                                                                data-testid={`log-request-${e.id}`}>
                                                                <MessageSquare size={11} /> Request
                                                            </Button>
                                                        )}
                                                        {canDelete ? (
                                                            <Button variant="ghost" size="iconSm"
                                                                className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                                onClick={() => handleDeleteEntry(e)}
                                                                data-testid={`log-delete-${e.id}`}>
                                                                <Trash2 size={11} />
                                                            </Button>
                                                        ) : (
                                                            <Button variant="ghost" size="iconSm" title="Request deletion"
                                                                className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                                                onClick={() => handleRequestDelete(e)}
                                                                data-testid={`log-request-delete-${e.id}`}>
                                                                <Trash2 size={11} />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    )}

                    {!logLoading && logEntries.length === 0 && (
                        <Panel bodyClass="p-0">
                            <EmptyState icon={List} title="No entries loaded"
                                message="Set any filters you need and press Load log. Leave them blank to see everything." />
                        </Panel>
                    )}
                </TabsContent>
            </Tabs>

            {/* =============================================== edit dialog */}
            <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
                <DialogContent className="sm:max-w-2xl" data-testid="edit-entry-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">
                            {canEdit ? 'Edit production entry' : 'Request a correction'}
                        </DialogTitle>
                    </DialogHeader>
                    {editDialog && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-[11.5px] sm:grid-cols-4">
                                {[['Lot', editDialog.lot_number], ['Operation', editDialog.operation_name],
                                ['Colour', editDialog.color], ['Date', editDialog.date]].map(([k, v]) => (
                                    <div key={k}>
                                        <span className="text-muted-foreground">{k}</span>
                                        <div className="font-medium text-slate-800">{v}</div>
                                    </div>
                                ))}
                            </div>

                            <div>
                                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Corrected quantities — {editDialog.operator_name}
                                </p>
                                <div className="overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full text-[12.5px]">
                                        <thead>
                                            <tr className="bg-slate-50">
                                                {editSizes.map(sz => (
                                                    <th key={sz} className="min-w-[68px] border-b border-l border-border/60 px-2 py-1.5 text-center text-[10px] font-semibold uppercase text-muted-foreground first:border-l-0">
                                                        {sz}
                                                    </th>
                                                ))}
                                                <th className="border-b border-l border-border px-3 py-1.5 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                                                    Total
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                {editSizes.map(sz => (
                                                    <td key={sz} className="border-l border-border/60 p-0 first:border-l-0">
                                                        <input type="number" min="0"
                                                            className="excel-input text-center"
                                                            placeholder="0"
                                                            value={editMatrix[sz] ?? ''}
                                                            onChange={e => setEditMatrix({ ...editMatrix, [sz]: e.target.value })}
                                                        />
                                                    </td>
                                                ))}
                                                <td className="tnum border-l border-border px-3 py-1 text-center font-bold">
                                                    {editSizes.reduce((s, sz) => s + (parseInt(editMatrix[sz]) || 0), 0)}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                                    <Info size={11} className="mt-0.5 shrink-0" />
                                    Every size on the lot is listed, including ones currently at zero, so a
                                    mistyped size can be corrected. Wages are recalculated automatically and
                                    the plan limit still applies.
                                </p>
                            </div>

                            <div>
                                <Label className="mb-1 block">
                                    <FieldLabel required={!canEdit}>Reason for the change</FieldLabel>
                                </Label>
                                <Input value={editReason} onChange={e => setEditReason(e.target.value)}
                                    placeholder="e.g. miscounted bundle, wrong size column"
                                    data-testid="edit-reason-input" autoFocus />
                            </div>

                            {editDialog.edit_history?.length > 0 && (
                                <div className="rounded-lg bg-slate-50 p-2.5">
                                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Previous changes
                                    </p>
                                    {editDialog.edit_history.map((h, idx) => (
                                        <p key={idx} className="text-[11px] text-slate-500">
                                            {h.edited_by_name} · {h.edited_at?.split('T')[0]}
                                            {h.old_values && (
                                                <span className="tnum ml-1 text-slate-400">
                                                    ({h.old_values.total_quantity} → {h.new_values?.total_quantity})
                                                </span>
                                            )}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
                        <Button
                            loading={editBusy}
                            onClick={canEdit ? handleAdminEdit : handleRequestEdit}
                            data-testid={canEdit ? 'save-edit' : 'submit-request'}
                        >
                            {canEdit ? 'Save changes' : 'Submit request'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
