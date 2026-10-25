import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { localDate } from '../lib/utils';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, FileText, Trash2, Download } from 'lucide-react';
import { PageHeader, Panel, EmptyState, Pill, SkeletonRows, num, inr, FieldLabel } from '../components/ui/primitives';

const TONE = { draft: 'slate', approved: 'brand', sent: 'leaf', partially_received: 'amber', received: 'green', closed: 'slate', cancelled: 'rose' };
const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]';
const numText = (v) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

export default function PurchaseOrdersPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [params] = useSearchParams();
    const [data, setData] = useState({ items: [], total: 0, pages: 1 });
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [lotId] = useState(params.get('lot') || '');
    const [page, setPage] = useState(1);
    const [suppliers, setSuppliers] = useState([]);
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(null);                    // the PO being viewed/edited
    const [draft, setDraft] = useState(null);                  // editable copy
    const [newOpen, setNewOpen] = useState(false);
    const [newPo, setNewPo] = useState({ supplier_id: '', lines: [{ item_id: '', qty: '', qty2: '', rate: '' }] });
    const [recv, setRecv] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        const p = new URLSearchParams({ page, page_size: 30 });
        if (status) p.set('status', status);
        if (lotId) p.set('lot_id', lotId);
        return api.get(`/purchase-orders?${p}`).then(r => setData(r.data)).catch(() => toast.error('Could not load purchase orders')).finally(() => setLoading(false));
    }, [status, lotId, page]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        Promise.all([api.get('/suppliers'), api.get('/stock/items')]).then(([s, i]) => { setSuppliers(s.data); setItems(i.data.filter(x => x.active !== false)); }).catch(() => {});
    }, []);

    const view = async (po) => {
        const r = await api.get(`/purchase-orders/${po.id}`);
        setOpen(r.data);
        setDraft({ supplier_id: r.data.supplier_id, expected_date: r.data.expected_date, terms: r.data.terms, notes: r.data.notes,
            lines: r.data.lines.map(l => ({ item_id: l.item_id, qty: String(l.qty), qty2: l.qty2 ? String(l.qty2) : '', rate: String(l.rate) })) });
    };

    const act = async (fn, okMsg) => {
        setBusy(true);
        try { const r = await fn(); if (okMsg) toast.success(okMsg); await load(); if (r?.data?.id) await view(r.data); return r; }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not do that', { duration: 8000 }); }
        finally { setBusy(false); }
    };
    const linesBody = (lines) => lines.map(l => ({ item_id: l.item_id, qty: parseFloat(l.qty), qty2: l.qty2 ? parseFloat(l.qty2) : null, rate: parseFloat(l.rate) || 0 }));

    const saveDraft = () => act(() => api.put(`/purchase-orders/${open.id}`, { supplier_id: draft.supplier_id, expected_date: draft.expected_date,
        terms: draft.terms, notes: draft.notes, lines: linesBody(draft.lines) }), 'Saved');
    const approve = async () => {
        if (isAdmin) return act(() => api.post(`/purchase-orders/${open.id}/approve`), 'Approved');
        return act(() => api.post('/approvals', { type: 'po_release', entity_id: open.id, reason: 'Please release this order' }).then(r => { setOpen(null); return r; }),
            'Sent to an administrator for approval');
    };
    const createPo = async () => {
        if (newPo.lines.some(l => !l.item_id || !(parseFloat(l.qty) > 0))) return toast.error('Every line needs an item and a quantity');
        const r = await act(() => api.post('/purchase-orders', { supplier_id: newPo.supplier_id || null, lines: linesBody(newPo.lines) }), 'Order drafted');
        if (r) setNewOpen(false);
    };
    const receive = async () => {
        const lines = Object.entries(recv.qty).filter(([, v]) => parseFloat(v) > 0).map(([i, v]) => ({ index: +i, qty: parseFloat(v), qty2: recv.qty2[i] ? parseFloat(recv.qty2[i]) : null }));
        if (!lines.length) return toast.error('Enter what arrived');
        if (!recv.bill.trim()) return toast.error('Enter the supplier bill or challan number');
        const r = await act(() => api.post(`/purchase-orders/${open.id}/receive`, { supplier_bill_no: recv.bill.trim(), date: recv.date, lines }), 'Material received');
        if (r) { (r.data.warnings || []).forEach(w => toast.warning(w, { duration: 9000 })); setRecv(null); }
    };

    const itemOf = (id) => items.find(i => i.id === id);
    const editable = open?.status === 'draft';

    // a plain function, not a component: a component declared inside render is rebuilt on every
    // keystroke, which throws the cursor out of the field it is typing in
    const renderLines = (lines, onChange) => (
        <div className="space-y-2">
            {lines.map((l, i) => {
                const it = itemOf(l.item_id);
                return (
                    <div key={i} className="grid grid-cols-12 items-end gap-2" data-testid={`po-line-${i}`}>
                        <div className="col-span-5"><select className={selectCls} value={l.item_id} aria-label={`Item ${i + 1}`}
                            onChange={e => onChange(lines.map((x, j) => j === i ? { ...x, item_id: e.target.value } : x))}>
                            <option value="">Item</option>{items.map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></div>
                        <div className="col-span-2"><Input className="mt-1 font-mono" placeholder={`Qty${it ? ` (${it.uom})` : ''}`} inputMode="decimal" value={l.qty}
                            onChange={e => onChange(lines.map((x, j) => j === i ? { ...x, qty: numText(e.target.value) } : x))} aria-label={`Quantity ${i + 1}`} data-testid={`po-qty-${i}`} /></div>
                        <div className="col-span-2">{it?.dual_unit ? <Input className="mt-1 font-mono" placeholder={it.uom2} inputMode="decimal" value={l.qty2}
                            onChange={e => onChange(lines.map((x, j) => j === i ? { ...x, qty2: numText(e.target.value) } : x))} aria-label={`${it.uom2} ${i + 1}`} /> : null}</div>
                        <div className="col-span-2"><Input className="mt-1 font-mono" placeholder="Rate" inputMode="decimal" value={l.rate}
                            onChange={e => onChange(lines.map((x, j) => j === i ? { ...x, rate: numText(e.target.value) } : x))} aria-label={`Rate ${i + 1}`} data-testid={`po-rate-${i}`} /></div>
                        <div className="col-span-1"><Button variant="ghost" size="sm" className="text-red-500" aria-label="Remove line" disabled={lines.length === 1}
                            onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></Button></div>
                    </div>
                );
            })}
            <Button variant="outline" size="sm" onClick={() => onChange([...lines, { item_id: '', qty: '', qty2: '', rate: '' }])}><Plus size={13} /> Add line</Button>
        </div>
    );

    return (
        <div className="space-y-4" data-testid="po-page">
            <PageHeader title="Purchase orders" icon={FileText} subtitle={lotId ? 'Orders for one lot' : 'Material orders: drafted from lot requirements or raised by hand'}
                actions={<Button onClick={() => { setNewPo({ supplier_id: '', lines: [{ item_id: '', qty: '', qty2: '', rate: '' }] }); setNewOpen(true); }} data-testid="new-po"><Plus size={15} /> New order</Button>} />
            <Panel bodyClass="p-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                    <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={status} onChange={e => { setPage(1); setStatus(e.target.value); }} aria-label="Status" data-testid="po-status">
                        <option value="">All statuses</option>{Object.keys(TONE).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
                    <span className="tnum ml-auto text-[11.5px] text-muted-foreground">{num(data.total)} orders</span>
                </div>
                {loading ? <SkeletonRows rows={5} cols={6} /> : data.items.length === 0 ? (
                    <EmptyState icon={FileText} title="No purchase orders" message="Add material requirements to a lot and orders are drafted for you, or raise one by hand." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                            <thead><tr className="border-b border-border bg-slate-50/90">
                                {['PO', 'Supplier', 'Lot', 'Lines', 'Total', 'Status', ''].map(h => <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{h}</th>)}
                            </tr></thead>
                            <tbody>
                                {data.items.map(po => (
                                    <tr key={po.id} className="cursor-pointer border-b border-border/60 hover:bg-brand-50/40" onClick={() => view(po)} data-testid={`po-row-${po.id}`}>
                                        <td className="px-3 py-2 font-mono text-[12px] font-semibold text-brand">{po.po_number}</td>
                                        <td className="px-3 py-2">{po.supplier_name || <span className="text-amber-600">no supplier yet</span>}</td>
                                        <td className="px-3 py-2 text-slate-500">{po.lot_number || '—'}</td>
                                        <td className="tnum px-3 py-2">{po.lines.length}</td>
                                        <td className="tnum px-3 py-2">{inr(po.total)}</td>
                                        <td className="px-3 py-2"><Pill tone={TONE[po.status]}>{po.status.replace('_', ' ')}</Pill>{po.auto && po.status === 'draft' && <span className="ml-1 text-[10px] text-slate-400">auto</span>}</td>
                                        <td className="px-3 py-2 text-right text-[11.5px] text-slate-400">{po.created_at?.slice(0, 10)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <span className="text-[12px] text-muted-foreground">Page {page} of {data.pages}</span>
                    <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
            </Panel>

            {/* ---------------------------------------------- detail */}
            <Dialog open={!!open} onOpenChange={() => setOpen(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="po-dialog">
                    {open && draft && (<>
                        <DialogHeader><DialogTitle className="font-outfit">{open.po_number} <Pill tone={TONE[open.status]} className="ml-2">{open.status.replace('_', ' ')}</Pill></DialogTitle></DialogHeader>
                        {open.lot_number && <p className="text-[12px] text-slate-500">For lot {open.lot_number}</p>}
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label><FieldLabel required>Supplier</FieldLabel></Label>
                                <select className={selectCls} disabled={!editable} value={draft.supplier_id || ''} onChange={e => setDraft({ ...draft, supplier_id: e.target.value })} data-testid="po-supplier">
                                    <option value="">Choose supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                            <div><Label><FieldLabel>Expected by</FieldLabel></Label>
                                <Input type="date" className="mt-1" disabled={!editable} value={draft.expected_date || ''} onChange={e => setDraft({ ...draft, expected_date: e.target.value })} /></div>
                        </div>
                        {editable ? renderLines(draft.lines, lines => setDraft({ ...draft, lines })) : (
                            <table className="w-full text-[12.5px]"><thead><tr className="border-b border-border">{['Item', 'Ordered', 'Received', 'Rate', 'Amount'].map(h => <th key={h} className="px-2 py-1 text-left text-[10px] uppercase text-muted-foreground">{h}</th>)}</tr></thead>
                                <tbody>{open.lines.map((l, i) => (
                                    <tr key={i} className="border-b border-border/50"><td className="px-2 py-1 font-medium">{l.item_name}</td>
                                        <td className="tnum px-2 py-1">{num(l.qty)} {l.uom}{l.qty2 ? ` · ${num(l.qty2)} ${l.uom2}` : ''}</td>
                                        <td className="tnum px-2 py-1">{num(l.received_qty)}{l.received_qty2 ? ` · ${num(l.received_qty2)}` : ''}</td>
                                        <td className="tnum px-2 py-1">{inr(l.rate)}</td><td className="tnum px-2 py-1">{inr(l.amount)}</td></tr>))}</tbody></table>
                        )}
                        <p className="tnum text-right text-[13px] font-semibold">Total {inr(open.total)}</p>
                        {open.history?.length > 0 && (
                            <details className="text-[12px] text-slate-500"><summary className="cursor-pointer">History</summary>
                                <ul className="mt-1 space-y-0.5">{open.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace('T', ' ')} · {h.by} · {h.event}</li>)}</ul></details>
                        )}
                        <DialogFooter className="flex-wrap gap-2">
                            <Button variant="outline" onClick={() => downloadFile(`/api/purchase-orders/${open.id}/pdf`, `${open.po_number.replace('/', '-')}.pdf`).catch(() => toast.error('Could not download'))} data-testid="po-pdf"><Download size={14} /> PDF</Button>
                            {editable && <Button variant="outline" disabled={busy} onClick={saveDraft} data-testid="po-save">Save changes</Button>}
                            {editable && <Button disabled={busy} onClick={approve} data-testid="po-approve">{isAdmin ? 'Approve' : 'Request approval'}</Button>}
                            {open.status === 'approved' && <Button disabled={busy} onClick={() => act(() => api.post(`/purchase-orders/${open.id}/send`), 'Marked as sent')} data-testid="po-send">Mark as sent</Button>}
                            {['approved', 'sent', 'partially_received'].includes(open.status) && (
                                <Button disabled={busy} onClick={() => setRecv({ qty: {}, qty2: {}, bill: '', date: localDate() })} data-testid="po-receive">Receive material</Button>)}
                            {['draft', 'approved', 'sent'].includes(open.status) && <Button variant="ghost" className="text-red-600" disabled={busy}
                                onClick={() => window.confirm(`Cancel ${open.po_number}?`) && act(() => api.post(`/purchase-orders/${open.id}/cancel`), 'Cancelled')} data-testid="po-cancel">Cancel order</Button>}
                            {['partially_received', 'received'].includes(open.status) && <Button variant="outline" disabled={busy} onClick={() => act(() => api.post(`/purchase-orders/${open.id}/close`), 'Closed')}>Close order</Button>}
                        </DialogFooter>
                    </>)}
                </DialogContent>
            </Dialog>

            {/* ---------------------------------------------- receive */}
            <Dialog open={!!recv} onOpenChange={() => setRecv(null)}>
                <DialogContent className="sm:max-w-lg" data-testid="receive-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Receive against {open?.po_number}</DialogTitle></DialogHeader>
                    {recv && open && (
                        <div className="space-y-3">
                            {open.lines.map((l, i) => (
                                <div key={i} className="grid grid-cols-12 items-end gap-2">
                                    <div className="col-span-5 text-[12.5px]"><strong>{l.item_name}</strong><br /><span className="text-slate-400">{num(l.received_qty)} of {num(l.qty)} {l.uom} so far</span></div>
                                    <div className="col-span-3"><Input className="font-mono" placeholder={l.uom} inputMode="decimal" value={recv.qty[i] || ''} aria-label={`Received ${l.item_name}`}
                                        onChange={e => setRecv({ ...recv, qty: { ...recv.qty, [i]: numText(e.target.value) } })} data-testid={`recv-qty-${i}`} /></div>
                                    <div className="col-span-3">{l.uom2 ? <Input className="font-mono" placeholder={l.uom2} inputMode="decimal" value={recv.qty2[i] || ''} aria-label={`${l.uom2} received`}
                                        onChange={e => setRecv({ ...recv, qty2: { ...recv.qty2, [i]: numText(e.target.value) } })} data-testid={`recv-qty2-${i}`} /> : null}</div>
                                </div>
                            ))}
                            <div className="grid grid-cols-2 gap-3">
                                <div><Label><FieldLabel required>Supplier bill / challan no.</FieldLabel></Label>
                                    <Input className="mt-1" value={recv.bill} onChange={e => setRecv({ ...recv, bill: e.target.value })} data-testid="recv-bill" /></div>
                                <div><Label><FieldLabel>Date</FieldLabel></Label>
                                    <Input type="date" className="mt-1" value={recv.date} onChange={e => setRecv({ ...recv, date: e.target.value })} /></div>
                            </div>
                        </div>
                    )}
                    <DialogFooter><Button variant="outline" onClick={() => setRecv(null)}>Cancel</Button><Button disabled={busy} onClick={receive} data-testid="recv-save">Record receipt</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ---------------------------------------------- new */}
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="new-po-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">New purchase order</DialogTitle></DialogHeader>
                    <div><Label><FieldLabel>Supplier</FieldLabel></Label>
                        <select className={selectCls} value={newPo.supplier_id} onChange={e => setNewPo({ ...newPo, supplier_id: e.target.value })}>
                            <option value="">Choose later</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                    {renderLines(newPo.lines, lines => setNewPo({ ...newPo, lines }))}
                    <DialogFooter><Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button><Button disabled={busy} onClick={createPo} data-testid="create-po">Create draft</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
