import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { localDate } from '../lib/utils';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, Boxes, Undo2, Search } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, SkeletonRows, num, inr, FieldLabel } from '../components/ui/primitives';

const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]';
const TYPES = [['receipt', 'Receive (from supplier)'], ['issue', 'Issue to a lot'], ['return', 'Return from a lot'],
    ['transfer', 'Move to another lot'], ['wastage', 'Wastage'], ['adjustment', 'Adjust (stock-take)']];
const TYPE_TONE = { receipt: 'green', issue: 'brand', return: 'leaf', transfer: 'amber', wastage: 'rose', adjustment: 'slate' };
const qtyText = (q, uom, q2, uom2) => `${num(q)} ${uom}${q2 ? ` · ${num(q2)} ${uom2}` : ''}`;
const numText = (v) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

const EMPTY_MOVE = { type: 'receipt', item_id: '', qty: '', qty2: '', date: localDate(), rate: '', supplier_id: '', supplier_bill_no: '',
    lot_id: '', to_lot_id: '', direction: -1, reason: '', note: '' };

export default function StockPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [tab, setTab] = useState('balances');
    const [items, setItems] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [lots, setLots] = useState([]);
    const [cats, setCats] = useState({ categories: [], uoms: [] });
    const [balances, setBalances] = useState([]);
    const [moves, setMoves] = useState({ items: [], total: 0, pages: 1 });
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({ category: '', q: '', low: false });
    const [mFilters, setMFilters] = useState({ type: '', q: '', date_from: '', date_to: '' });
    const [page, setPage] = useState(1);
    const [moveOpen, setMoveOpen] = useState(false);
    const [move, setMove] = useState(EMPTY_MOVE);
    const [itemOpen, setItemOpen] = useState(null);       // null | 'new' | item
    const [itemForm, setItemForm] = useState({});
    const [supOpen, setSupOpen] = useState(null);
    const [supForm, setSupForm] = useState({});
    const [ledger, setLedger] = useState(null);
    const [saving, setSaving] = useState(false);

    const loadMasters = useCallback(() => Promise.all([
        api.get('/stock/items'), api.get('/suppliers'), api.get('/lots'), api.get('/stock/categories'),
    ]).then(([i, s, l, c]) => { setItems(i.data); setSuppliers(s.data); setLots(l.data); setCats(c.data); })
        .catch(() => toast.error('Could not load stock data')), []);
    const loadBalances = useCallback(() => {
        setLoading(true);
        const p = new URLSearchParams();
        if (filters.category) p.set('category', filters.category);
        if (filters.q) p.set('q', filters.q);
        if (filters.low) p.set('low_only', 'true');
        return api.get(`/stock/balances?${p}`).then(r => setBalances(r.data)).catch(() => toast.error('Could not load balances')).finally(() => setLoading(false));
    }, [filters]);
    const loadMoves = useCallback(() => {
        const p = new URLSearchParams({ page, page_size: 30 });
        Object.entries(mFilters).forEach(([k, v]) => { if (v) p.set(k, v); });
        return api.get(`/stock/movements?${p}`).then(r => setMoves(r.data)).catch(() => toast.error('Could not load movements'));
    }, [mFilters, page]);

    useEffect(() => { loadMasters(); }, [loadMasters]);
    useEffect(() => { loadBalances(); }, [loadBalances]);
    useEffect(() => { if (tab === 'movements') loadMoves(); }, [tab, loadMoves]);

    const refresh = () => { loadMasters(); loadBalances(); if (tab === 'movements') loadMoves(); };
    const item = useMemo(() => items.find(i => i.id === move.item_id), [items, move.item_id]);
    const needsLot = ['issue', 'return', 'transfer'].includes(move.type);
    const ratio = item?.dual_unit && parseFloat(move.qty) > 0 && parseFloat(move.qty2) > 0
        ? (parseFloat(move.qty2) / parseFloat(move.qty)) : null;

    const openMove = (type = 'receipt', itemId = '') => {
        setMove({ ...EMPTY_MOVE, type, item_id: itemId, date: localDate() });
        setMoveOpen(true);
    };

    const submitMove = async () => {
        if (!move.item_id) return toast.error('Choose the item');
        if (!(parseFloat(move.qty) > 0)) return toast.error('Enter the quantity');
        if (item?.dual_unit && !(parseFloat(move.qty2) > 0)) return toast.error(`Enter the ${item.uom2} as well; ${item.name} is counted two ways`);
        const body = { type: move.type, item_id: move.item_id, qty: parseFloat(move.qty), date: move.date, reason: move.reason, note: move.note };
        if (item?.dual_unit) body.qty2 = parseFloat(move.qty2);
        if (move.type === 'receipt') Object.assign(body, { supplier_id: move.supplier_id, supplier_bill_no: move.supplier_bill_no, rate: move.rate === '' ? 0 : parseFloat(move.rate) });
        if (needsLot) body.lot_id = move.lot_id;
        if (move.type === 'transfer') body.to_lot_id = move.to_lot_id;
        if (move.type === 'wastage' && move.lot_id) body.lot_id = move.lot_id;
        if (move.type === 'adjustment') body.direction = move.direction;
        setSaving(true);
        try {
            // accounts cannot adjust stock directly: it becomes a request for an administrator
            if (move.type === 'adjustment' && !isAdmin) {
                await api.post('/approvals', { type: 'stock_adjustment', entity_id: move.item_id, reason: move.reason, payload: body });
                toast.success('Sent for approval. The stock changes once an administrator approves.');
            } else {
                const r = await api.post('/stock/movements', body);
                toast.success(`${r.data.no} recorded`);
                (r.data.warnings || []).forEach(w => toast.warning(w, { duration: 9000 }));
            }
            setMoveOpen(false); refresh();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 8000 }); }
        finally { setSaving(false); }
    };

    const reverse = async (m) => {
        const reason = window.prompt(`Why reverse ${m.no} (${m.item_name})?`);
        if (!reason?.trim()) return;
        try { await api.post(`/stock/movements/${m.id}/reverse`, { reason: reason.trim() }); toast.success('Reversed'); refresh(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not reverse', { duration: 8000 }); }
    };

    const openLedger = async (row) => {
        try { const r = await api.get(`/stock/ledger/${row.id}`); setLedger(r.data); }
        catch { toast.error('Could not load the ledger'); }
    };

    const saveItem = async () => {
        if (!itemForm.name?.trim()) return toast.error('Name is required');
        const body = { name: itemForm.name.trim(), category: itemForm.category, reorder_level: parseFloat(itemForm.reorder_level) || 0,
            preferred_supplier_id: itemForm.preferred_supplier_id || null, notes: itemForm.notes || '' };
        try {
            if (itemOpen === 'new') await api.post('/stock/items', { ...body, uom: itemForm.uom, dual_unit: !!itemForm.dual_unit, uom2: itemForm.uom2 });
            else await api.put(`/stock/items/${itemOpen.id}`, body);
            toast.success('Saved'); setItemOpen(null); refresh();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 7000 }); }
    };
    const saveSupplier = async () => {
        if (!supForm.name?.trim()) return toast.error('Name is required');
        try {
            if (supOpen === 'new') await api.post('/suppliers', supForm); else await api.put(`/suppliers/${supOpen.id}`, supForm);
            toast.success('Saved'); setSupOpen(null); refresh();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 7000 }); }
    };

    const tabs = [['balances', 'Balances'], ['movements', 'Movements'], ['items', 'Items'], ['suppliers', 'Suppliers']];

    return (
        <div className="space-y-4" data-testid="stock-page">
            <PageHeader title="Stock" icon={Boxes} subtitle="Yarn, elastic, labels, stickers, fusing and everything else in the store"
                actions={<Button onClick={() => openMove()} data-testid="new-movement"><Plus size={15} /> New movement</Button>} />
            <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-0.5" role="tablist">
                {tabs.map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`stock-tab-${k}`}
                        className={`press cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium ${tab === k ? 'bg-card text-brand shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
                ))}
            </div>

            {tab === 'balances' && (
                <Panel bodyClass="p-0">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                        <div className="relative min-w-[200px] max-w-xs flex-1">
                            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <Input className="h-8 pl-8 text-[12.5px]" placeholder="Search items" value={filters.q}
                                onChange={e => setFilters({ ...filters, q: e.target.value })} data-testid="stock-search" />
                        </div>
                        <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={filters.category}
                            onChange={e => setFilters({ ...filters, category: e.target.value })} aria-label="Category" data-testid="stock-category">
                            <option value="">All categories</option>
                            {cats.categories.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                        </select>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600">
                            <input type="checkbox" checked={filters.low} onChange={e => setFilters({ ...filters, low: e.target.checked })} data-testid="stock-low-only" /> Low stock only
                        </label>
                    </div>
                    {loading ? <SkeletonRows rows={6} cols={5} /> : balances.length === 0 ? (
                        <EmptyState icon={Boxes} title="No stock items yet" message="Add items under the Items tab, then record what you receive."
                            action={<Button onClick={() => { setTab('items'); setItemForm({ category: 'yarn', uom: 'pcs', uom2: 'kg' }); setItemOpen('new'); }}>Add the first item</Button>} />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead><tr className="border-b border-border bg-slate-50/90">
                                    {['Code', 'Item', 'Category', 'In store', 'Avg rate', 'Value', ''].map((h, i) => (
                                        <th key={h + i} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`}>{h}</th>))}
                                </tr></thead>
                                <tbody>
                                    {balances.map(b => (
                                        <tr key={b.id} className="cursor-pointer border-b border-border/60 hover:bg-brand-50/40" onClick={() => openLedger(b)} data-testid={`balance-row-${b.id}`}>
                                            <td className="px-3 py-2 font-mono text-[12px] text-brand">{b.code}</td>
                                            <td className="px-3 py-2 font-medium text-slate-800">{b.name}{b.low && <Pill tone="rose" className="ml-2">low</Pill>}</td>
                                            <td className="px-3 py-2 capitalize text-slate-500">{b.category.replace('_', ' ')}</td>
                                            <td className="tnum px-3 py-2 text-right font-semibold">{qtyText(b.balance, b.uom, b.dual_unit ? b.balance2 : 0, b.uom2)}</td>
                                            <td className="tnum px-3 py-2 text-right text-slate-500">{b.avg_rate != null ? inr(b.avg_rate) : '—'}</td>
                                            <td className="tnum px-3 py-2 text-right text-slate-500">{b.value != null ? inr(b.value, { decimals: 0 }) : '—'}</td>
                                            <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); openMove('issue', b.id); }}>Issue</Button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Panel>
            )}

            {tab === 'movements' && (
                <Panel bodyClass="p-0">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                        <Input className="h-8 max-w-[220px] text-[12.5px]" placeholder="Item, no., bill or lot" value={mFilters.q}
                            onChange={e => { setPage(1); setMFilters({ ...mFilters, q: e.target.value }); }} data-testid="move-search" />
                        <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={mFilters.type} aria-label="Type"
                            onChange={e => { setPage(1); setMFilters({ ...mFilters, type: e.target.value }); }}>
                            <option value="">All types</option>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <Input type="date" className="h-8 w-36 text-[12.5px]" value={mFilters.date_from} aria-label="From" onChange={e => { setPage(1); setMFilters({ ...mFilters, date_from: e.target.value }); }} />
                        <Input type="date" className="h-8 w-36 text-[12.5px]" value={mFilters.date_to} aria-label="To" onChange={e => { setPage(1); setMFilters({ ...mFilters, date_to: e.target.value }); }} />
                    </div>
                    {moves.items.length === 0 ? <EmptyState icon={Boxes} title="No movements" message="Receive, issue or adjust stock to see it here." compact /> : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[12.5px]">
                                <thead><tr className="border-b border-border bg-slate-50/90">
                                    {['No.', 'Date', 'Type', 'Item', 'Quantity', 'Lot / supplier', 'Reason', ''].map(h => (
                                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>))}
                                </tr></thead>
                                <tbody>
                                    {moves.items.map(m => (
                                        <tr key={m.id} className={`border-b border-border/60 ${m.sign === -1 ? 'bg-slate-50 text-slate-400' : ''}`} data-testid={`move-row-${m.id}`}>
                                            <td className="px-3 py-1.5 font-mono text-[11.5px]">{m.no}</td>
                                            <td className="tnum px-3 py-1.5">{m.date}</td>
                                            <td className="px-3 py-1.5"><Pill tone={TYPE_TONE[m.type]}>{m.sign === -1 ? `reversal of ${m.type}` : m.type}</Pill></td>
                                            <td className="px-3 py-1.5 font-medium">{m.item_name}</td>
                                            <td className="tnum px-3 py-1.5">{m.type === 'adjustment' ? (m.direction > 0 ? '+' : '−') : ''}{qtyText(m.qty, m.uom, m.qty2, m.uom2)}</td>
                                            <td className="px-3 py-1.5 text-slate-500">{m.type === 'transfer' ? `${m.lot_number} → ${m.to_lot_number}` : (m.lot_number || m.supplier_name || '—')}{m.supplier_bill_no && ` · ${m.supplier_bill_no}`}</td>
                                            <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-500" title={m.reason}>{m.reason}</td>
                                            <td className="px-3 py-1.5 text-right">
                                                {isAdmin && m.sign !== -1 && !m.reversed_by && <Button variant="ghost" size="sm" title="Reverse" onClick={() => reverse(m)} data-testid={`reverse-${m.id}`}><Undo2 size={13} /></Button>}
                                                {m.reversed_by && <span className="text-[10.5px] text-slate-400">reversed</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="tnum">{num(moves.total)} movements · page {page} of {moves.pages}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                            <Button variant="outline" size="sm" disabled={page >= moves.pages} onClick={() => setPage(page + 1)}>Next</Button>
                        </div>
                    </div>
                </Panel>
            )}

            {tab === 'items' && (
                <Panel bodyClass="p-0" actions={<Button size="sm" onClick={() => { setItemForm({ category: 'yarn', uom: 'pcs', uom2: 'kg', reorder_level: '' }); setItemOpen('new'); }} data-testid="add-item"><Plus size={14} /> Add item</Button>}>
                    <table className="w-full text-[13px]">
                        <thead><tr className="border-b border-border bg-slate-50/90">
                            {['Code', 'Name', 'Category', 'Counted in', 'Reorder at', 'Usual supplier', ''].map(h => <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>)}
                        </tr></thead>
                        <tbody>
                            {items.map(i => (
                                <tr key={i.id} className="border-b border-border/60" data-testid={`item-row-${i.id}`}>
                                    <td className="px-3 py-2 font-mono text-[12px] text-brand">{i.code}</td>
                                    <td className="px-3 py-2 font-medium">{i.name}{i.active === false && <Pill className="ml-2">off</Pill>}</td>
                                    <td className="px-3 py-2 capitalize text-slate-500">{i.category.replace('_', ' ')}</td>
                                    <td className="px-3 py-2 text-slate-600">{i.uom}{i.dual_unit && ` + ${i.uom2}`}</td>
                                    <td className="tnum px-3 py-2">{i.reorder_level || '—'}</td>
                                    <td className="px-3 py-2 text-slate-500">{suppliers.find(s => s.id === i.preferred_supplier_id)?.name || '—'}</td>
                                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => { setItemForm({ ...i }); setItemOpen(i); }}>Edit</Button></td>
                                </tr>
                            ))}
                            {items.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-400">No items yet</td></tr>}
                        </tbody>
                    </table>
                </Panel>
            )}

            {tab === 'suppliers' && (
                <Panel bodyClass="p-0" actions={<Button size="sm" onClick={() => { setSupForm({ name: '' }); setSupOpen('new'); }} data-testid="add-supplier"><Plus size={14} /> Add supplier</Button>}>
                    <table className="w-full text-[13px]">
                        <thead><tr className="border-b border-border bg-slate-50/90">
                            {['Name', 'Contact', 'Phone', 'GSTIN', ''].map(h => <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>)}
                        </tr></thead>
                        <tbody>
                            {suppliers.map(s => (
                                <tr key={s.id} className="border-b border-border/60">
                                    <td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2 text-slate-500">{s.contact || '—'}</td>
                                    <td className="px-3 py-2 text-slate-500">{s.phone || '—'}</td><td className="px-3 py-2 font-mono text-[12px] text-slate-500">{s.gstin || '—'}</td>
                                    <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => { setSupForm({ ...s }); setSupOpen(s); }}>Edit</Button></td>
                                </tr>
                            ))}
                            {suppliers.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-400">No suppliers yet</td></tr>}
                        </tbody>
                    </table>
                </Panel>
            )}

            {/* ------------------------------------------------ movement dialog */}
            <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="movement-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">New stock movement</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3 py-1">
                        <div className="col-span-2"><Label><FieldLabel required>What happened</FieldLabel></Label>
                            <select className={selectCls} value={move.type} onChange={e => setMove({ ...move, type: e.target.value })} data-testid="move-type">
                                {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select></div>
                        <div className="col-span-2"><Label><FieldLabel required>Item</FieldLabel></Label>
                            <select className={selectCls} value={move.item_id} onChange={e => setMove({ ...move, item_id: e.target.value, qty2: '' })} data-testid="move-item">
                                <option value="">Choose item</option>{items.filter(i => i.active !== false).map(i => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
                            </select></div>
                        <div><Label><FieldLabel required>Quantity {item && `(${item.uom})`}</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={move.qty} onChange={e => setMove({ ...move, qty: numText(e.target.value) })} data-testid="move-qty" /></div>
                        {item?.dual_unit ? (
                            <div><Label><FieldLabel required>Weight ({item.uom2})</FieldLabel></Label>
                                <Input className="mt-1 font-mono" inputMode="decimal" value={move.qty2} onChange={e => setMove({ ...move, qty2: numText(e.target.value) })} data-testid="move-qty2" />
                                {ratio && <p className="mt-0.5 text-[10.5px] text-slate-400">{ratio.toFixed(3)} {item.uom2} per {item.uom}</p>}</div>
                        ) : <div />}
                        <div><Label><FieldLabel>Date</FieldLabel></Label>
                            <Input type="date" className="mt-1" value={move.date} onChange={e => setMove({ ...move, date: e.target.value })} /></div>
                        {move.type === 'receipt' && (<>
                            <div><Label><FieldLabel>Rate per {item?.uom || 'unit'}</FieldLabel></Label>
                                <Input className="mt-1 font-mono" inputMode="decimal" value={move.rate} onChange={e => setMove({ ...move, rate: numText(e.target.value) })} data-testid="move-rate" /></div>
                            <div><Label><FieldLabel required>Supplier</FieldLabel></Label>
                                <select className={selectCls} value={move.supplier_id} onChange={e => setMove({ ...move, supplier_id: e.target.value })} data-testid="move-supplier">
                                    <option value="">Choose</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                            <div><Label><FieldLabel required>Bill / challan no.</FieldLabel></Label>
                                <Input className="mt-1" value={move.supplier_bill_no} onChange={e => setMove({ ...move, supplier_bill_no: e.target.value })} data-testid="move-bill" /></div>
                        </>)}
                        {(needsLot || move.type === 'wastage') && (
                            <div className="col-span-2"><Label><FieldLabel required={needsLot}>{move.type === 'transfer' ? 'From lot' : 'Lot'}</FieldLabel></Label>
                                <select className={selectCls} value={move.lot_id} onChange={e => setMove({ ...move, lot_id: e.target.value })} data-testid="move-lot">
                                    <option value="">{move.type === 'wastage' ? 'Store (no lot)' : 'Choose lot'}</option>
                                    {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.style_name}</option>)}</select></div>
                        )}
                        {move.type === 'transfer' && (
                            <div className="col-span-2"><Label><FieldLabel required>To lot</FieldLabel></Label>
                                <select className={selectCls} value={move.to_lot_id} onChange={e => setMove({ ...move, to_lot_id: e.target.value })} data-testid="move-to-lot">
                                    <option value="">Choose lot</option>{lots.filter(l => l.id !== move.lot_id).map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.style_name}</option>)}</select></div>
                        )}
                        {move.type === 'adjustment' && (
                            <div className="col-span-2 flex gap-4 text-[13px]">
                                {[[1, 'Add to stock'], [-1, 'Remove from stock']].map(([d, l]) => (
                                    <label key={d} className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="dir" checked={move.direction === d} onChange={() => setMove({ ...move, direction: d })} /> {l}</label>))}
                                {!isAdmin && <span className="text-[11px] text-amber-700">This is sent to an administrator for approval.</span>}
                            </div>
                        )}
                        {['transfer', 'wastage', 'adjustment'].includes(move.type) && (
                            <div className="col-span-2"><Label><FieldLabel required>Reason</FieldLabel></Label>
                                <Input className="mt-1" value={move.reason} onChange={e => setMove({ ...move, reason: e.target.value })} placeholder={move.type === 'transfer' ? 'e.g. shade mismatch, moving to the next lot' : 'e.g. damaged, stock-take'} data-testid="move-reason" /></div>
                        )}
                        <div className="col-span-2"><Label><FieldLabel>Note</FieldLabel></Label>
                            <Input className="mt-1" value={move.note} onChange={e => setMove({ ...move, note: e.target.value })} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMoveOpen(false)}>Cancel</Button>
                        <Button loading={saving} onClick={submitMove} data-testid="save-movement">{move.type === 'adjustment' && !isAdmin ? 'Request approval' : 'Save'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ------------------------------------------------ item dialog */}
            <Dialog open={!!itemOpen} onOpenChange={() => setItemOpen(null)}>
                <DialogContent className="sm:max-w-md" data-testid="item-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{itemOpen === 'new' ? 'New stock item' : 'Edit item'}</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3 py-1">
                        <div className="col-span-2"><Label><FieldLabel required>Name</FieldLabel></Label>
                            <Input className="mt-1" value={itemForm.name || ''} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} autoFocus data-testid="item-name" /></div>
                        <div><Label><FieldLabel>Category</FieldLabel></Label>
                            <select className={selectCls} value={itemForm.category || 'other'} onChange={e => setItemForm({ ...itemForm, category: e.target.value })} data-testid="item-category">
                                {cats.categories.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></div>
                        <div><Label><FieldLabel>Reorder when below</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={itemForm.reorder_level ?? ''} onChange={e => setItemForm({ ...itemForm, reorder_level: numText(e.target.value) })} /></div>
                        {itemOpen === 'new' && (<>
                            <div><Label><FieldLabel>Counted in</FieldLabel></Label>
                                <select className={selectCls} value={itemForm.uom || 'pcs'} onChange={e => setItemForm({ ...itemForm, uom: e.target.value })} data-testid="item-uom">
                                    {cats.uoms.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                            <label className="flex cursor-pointer items-end gap-2 pb-2 text-[13px]">
                                <input type="checkbox" checked={!!itemForm.dual_unit} onChange={e => setItemForm({ ...itemForm, dual_unit: e.target.checked })} data-testid="item-dual" /> Also weighed (two entries)</label>
                            {itemForm.dual_unit && <div><Label><FieldLabel>Second unit</FieldLabel></Label>
                                <select className={selectCls} value={itemForm.uom2 || 'kg'} onChange={e => setItemForm({ ...itemForm, uom2: e.target.value })} data-testid="item-uom2">
                                    {cats.uoms.map(u => <option key={u} value={u}>{u}</option>)}</select></div>}
                        </>)}
                        <div className="col-span-2"><Label><FieldLabel>Usual supplier</FieldLabel></Label>
                            <select className={selectCls} value={itemForm.preferred_supplier_id || ''} onChange={e => setItemForm({ ...itemForm, preferred_supplier_id: e.target.value })}>
                                <option value="">None</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setItemOpen(null)}>Cancel</Button><Button onClick={saveItem} data-testid="save-item">Save</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ------------------------------------------------ supplier dialog */}
            <Dialog open={!!supOpen} onOpenChange={() => setSupOpen(null)}>
                <DialogContent className="sm:max-w-md" data-testid="supplier-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{supOpen === 'new' ? 'New supplier' : 'Edit supplier'}</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-1">
                        {[['name', 'Name', true], ['contact', 'Contact person'], ['phone', 'Phone'], ['email', 'Email'], ['gstin', 'GSTIN'], ['address', 'Address']].map(([k, l, req]) => (
                            <div key={k}><Label><FieldLabel required={req}>{l}</FieldLabel></Label>
                                <Input className="mt-1" value={supForm[k] || ''} onChange={e => setSupForm({ ...supForm, [k]: e.target.value })} data-testid={`supplier-${k}`} /></div>))}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setSupOpen(null)}>Cancel</Button><Button onClick={saveSupplier} data-testid="save-supplier">Save</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ------------------------------------------------ ledger */}
            <Dialog open={!!ledger} onOpenChange={() => setLedger(null)}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="ledger-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">{ledger?.item?.name} · ledger</DialogTitle></DialogHeader>
                    <p className="text-[12.5px] text-slate-500">In store: <strong>{ledger && qtyText(ledger.balance[0], ledger.item.uom, ledger.item.dual_unit ? ledger.balance[1] : 0, ledger.item.uom2)}</strong></p>
                    <table className="w-full text-[12px]">
                        <thead><tr className="border-b border-border">{['No.', 'Date', 'Type', 'Qty', 'Balance', 'Lot'].map(h => <th key={h} className="px-2 py-1 text-left text-[10px] uppercase text-muted-foreground">{h}</th>)}</tr></thead>
                        <tbody>{ledger?.movements.map(m => (
                            <tr key={m.id} className="border-b border-border/50"><td className="px-2 py-1 font-mono">{m.no}</td><td className="px-2 py-1">{m.date}</td>
                                <td className="px-2 py-1">{m.sign === -1 ? `reversal of ${m.type}` : m.type}</td><td className="tnum px-2 py-1">{qtyText(m.qty, m.uom, m.qty2, m.uom2)}</td>
                                <td className="tnum px-2 py-1 font-semibold">{num(m.balance)}{ledger.item.dual_unit && ` · ${num(m.balance2)}`}</td><td className="px-2 py-1 text-slate-500">{m.lot_number || '—'}</td></tr>))}</tbody>
                    </table>
                </DialogContent>
            </Dialog>
        </div>
    );
}
