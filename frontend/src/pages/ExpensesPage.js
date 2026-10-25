import { useCallback, useEffect, useState } from 'react';
import api, { downloadFile, BACKEND_URL } from '../lib/api';
import { localDate } from '../lib/utils';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Plus, Receipt, Paperclip, Download, Tags, Ban } from 'lucide-react';
import { PageHeader, Panel, StatCard, EmptyState, Pill, SkeletonRows, num, inr, FieldLabel } from '../components/ui/primitives';

const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-[13px]';
const TONE = { approved: 'green', pending_approval: 'amber', rejected: 'rose', void: 'slate' };
const PAY_TONE = { paid: 'green', partial: 'amber', unpaid: 'rose' };
const numText = (v) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const BLANK = () => ({ date: localDate(), category_id: '', vendor: '', bill_no: '', description: '', amount: '', gst_amount: '', paid_amount: '',
    payment_mode: 'cash', lot_id: '', machine_ref: '', allow_duplicate: false, duplicate_reason: '' });

export default function ExpensesPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [cats, setCats] = useState([]);
    const [lots, setLots] = useState([]);
    const [data, setData] = useState({ items: [], count: 0, pages: 1, totals: { total: 0, paid: 0, unpaid: 0 } });
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({ q: '', category_id: '', payment_status: '', date_from: '', date_to: '' });
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(BLANK());
    const [file, setFile] = useState(null);
    const [dupHint, setDupHint] = useState(false);
    const [payOpen, setPayOpen] = useState(null);
    const [pay, setPay] = useState({ amount: '', mode: 'cash', date: localDate() });
    const [catOpen, setCatOpen] = useState(false);
    const [newCat, setNewCat] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        const p = new URLSearchParams({ page, page_size: 30 });
        Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
        return Promise.all([api.get(`/expenses?${p}`), api.get('/expenses/summary')])
            .then(([e, s]) => { setData(e.data); setSummary(s.data); })
            .catch(() => toast.error('Could not load expenses')).finally(() => setLoading(false));
    }, [filters, page]);
    const loadMasters = useCallback(() => Promise.all([api.get('/expense-categories'), api.get('/lots')])
        .then(([c, l]) => { setCats(c.data); setLots(l.data); }).catch(() => {}), []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadMasters(); }, [loadMasters]);

    const total = (parseFloat(form.amount) || 0) + (parseFloat(form.gst_amount) || 0);

    const save = async () => {
        if (!form.category_id) return toast.error('Choose a category');
        if (!form.vendor.trim()) return toast.error('Enter the vendor');
        if (!(parseFloat(form.amount) > 0)) return toast.error('Enter the amount');
        setSaving(true);
        try {
            const body = { date: form.date, category_id: form.category_id, vendor: form.vendor.trim(), bill_no: form.bill_no, description: form.description,
                amount: parseFloat(form.amount), gst_amount: parseFloat(form.gst_amount) || 0, paid_amount: parseFloat(form.paid_amount) || 0,
                payment_mode: parseFloat(form.paid_amount) > 0 ? form.payment_mode : '', lot_id: form.lot_id || null, machine_ref: form.machine_ref,
                allow_duplicate: form.allow_duplicate, duplicate_reason: form.duplicate_reason };
            const r = await api.post('/expenses', body);
            if (file) {
                const fd = new FormData(); fd.append('file', file);
                try { await api.post(`/expenses/${r.data.id}/attachment`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
                catch (err) { toast.error(`Bill saved, but the file was not attached: ${err.response?.data?.detail || 'upload failed'}`, { duration: 9000 }); }
            }
            toast.success(r.data.status === 'pending_approval' ? `${r.data.voucher_no} saved. It is waiting for an administrator to approve it.` : `${r.data.voucher_no} saved`, { duration: 6000 });
            setOpen(false); setFile(null); setDupHint(false); load();
        } catch (err) {
            const msg = err.response?.data?.detail || 'Could not save';
            if (String(msg).includes('already recorded')) setDupHint(true);
            toast.error(msg, { duration: 9000 });
        } finally { setSaving(false); }
    };

    const doPay = async () => {
        if (!(parseFloat(pay.amount) > 0)) return toast.error('Enter the amount paid');
        try { await api.post(`/expenses/${payOpen.id}/pay`, { amount: parseFloat(pay.amount), mode: pay.mode, date: pay.date }); toast.success('Payment recorded'); setPayOpen(null); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not record', { duration: 7000 }); }
    };
    const voidBill = async (e) => {
        const reason = window.prompt(`Why void ${e.voucher_no} (${e.vendor})? It stays on record, marked void.`);
        if (!reason?.trim()) return;
        try { await api.post(`/expenses/${e.id}/void`, { reason: reason.trim() }); toast.success('Voided'); load(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not void'); }
    };
    const openFile = async (e) => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/expenses/${e.id}/attachment`, { credentials: 'include' });
            if (!res.ok) throw new Error();
            window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
        } catch { toast.error('Could not open the file'); }
    };
    const exportXlsx = () => {
        const p = new URLSearchParams(); Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
        downloadFile(`/api/expenses/export?${p}`, 'expenses.xlsx').catch(() => toast.error('Export failed'));
    };
    const addCat = async () => {
        if (!newCat.trim()) return;
        try { await api.post('/expense-categories', { name: newCat.trim() }); setNewCat(''); loadMasters(); toast.success('Category added'); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not add'); }
    };

    return (
        <div className="space-y-4" data-testid="expenses-page">
            <PageHeader title="Expenses" icon={Receipt} subtitle="Service, maintenance, accessories and other bills"
                actions={<>
                    {isAdmin && <Button variant="outline" onClick={() => setCatOpen(true)} data-testid="manage-categories"><Tags size={15} /> Categories</Button>}
                    <Button variant="outline" onClick={exportXlsx} data-testid="export-expenses"><Download size={15} /> Excel</Button>
                    <Button onClick={() => { setForm(BLANK()); setFile(null); setDupHint(false); setOpen(true); }} data-testid="new-expense"><Plus size={15} /> New bill</Button>
                </>} />
            {summary && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatCard i={0} label={`Spent in ${summary.month}`} value={summary.month_total} format={(n) => inr(n, { decimals: 0 })} tone="brand" icon={Receipt} sub={`${summary.by_category.length} categories`} />
                    <StatCard i={1} label="Still to pay" value={summary.unpaid_total} format={(n) => inr(n, { decimals: 0 })} tone="amber" sub="all unpaid bills" />
                    <StatCard i={2} label="Unpaid over 30 days" value={summary.unpaid_aging['31-60'] + summary.unpaid_aging['60+']} format={(n) => inr(n, { decimals: 0 })} tone="slate" sub="by bill date" />
                    <StatCard i={3} label="In this view" value={data.totals.total} format={(n) => inr(n, { decimals: 0 })} tone="leaf" sub={`${num(data.count)} bills`} />
                </div>
            )}
            <Panel bodyClass="p-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                    <Input className="h-8 max-w-[220px] text-[12.5px]" placeholder="Vendor, bill no., machine…" value={filters.q}
                        onChange={e => { setPage(1); setFilters({ ...filters, q: e.target.value }); }} data-testid="expense-search" />
                    <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={filters.category_id} aria-label="Category"
                        onChange={e => { setPage(1); setFilters({ ...filters, category_id: e.target.value }); }}>
                        <option value="">All categories</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    <select className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]" value={filters.payment_status} aria-label="Payment"
                        onChange={e => { setPage(1); setFilters({ ...filters, payment_status: e.target.value }); }}>
                        <option value="">Paid or unpaid</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option></select>
                    <Input type="date" className="h-8 w-36 text-[12.5px]" aria-label="From" value={filters.date_from} onChange={e => { setPage(1); setFilters({ ...filters, date_from: e.target.value }); }} />
                    <Input type="date" className="h-8 w-36 text-[12.5px]" aria-label="To" value={filters.date_to} onChange={e => { setPage(1); setFilters({ ...filters, date_to: e.target.value }); }} />
                </div>
                {loading ? <SkeletonRows rows={6} cols={6} /> : data.items.length === 0 ? (
                    <EmptyState icon={Receipt} title="No bills" message={cats.length === 0 ? 'An administrator needs to add categories first (Service, Maintenance, Accessories…).' : 'Record a bill with New bill.'} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[12.5px]">
                            <thead><tr className="border-b border-border bg-slate-50/90">
                                {['Voucher', 'Date', 'Category', 'Vendor / bill', 'Lot', 'Total', 'Balance', 'Status', ''].map(h => (
                                    <th key={h} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${h === 'Total' || h === 'Balance' ? 'text-right' : 'text-left'}`}>{h}</th>))}
                            </tr></thead>
                            <tbody>
                                {data.items.map(e => (
                                    <tr key={e.id} className={`border-b border-border/60 ${e.status === 'void' ? 'text-slate-400 line-through' : ''}`} data-testid={`expense-row-${e.id}`}>
                                        <td className="px-3 py-2 font-mono text-[11.5px] text-brand">{e.voucher_no}</td>
                                        <td className="tnum px-3 py-2">{e.date}</td>
                                        <td className="px-3 py-2">{e.category_name}</td>
                                        <td className="px-3 py-2"><span className="font-medium">{e.vendor}</span>{e.bill_no && <span className="text-slate-400"> · {e.bill_no}</span>}
                                            {e.description && <span className="block max-w-[260px] truncate text-[11px] text-slate-400" title={e.description}>{e.description}</span>}</td>
                                        <td className="px-3 py-2 text-slate-500">{e.lot_number || '—'}</td>
                                        <td className="tnum px-3 py-2 text-right">{inr(e.total)}</td>
                                        <td className="tnum px-3 py-2 text-right">{e.balance > 0 ? inr(e.balance) : '—'}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            {e.status !== 'approved' ? <Pill tone={TONE[e.status]}>{e.status.replace('_', ' ')}</Pill> : <Pill tone={PAY_TONE[e.payment_status]}>{e.payment_status}</Pill>}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right">
                                            {e.has_attachment && <Button variant="ghost" size="sm" title="Open bill" onClick={() => openFile(e)} data-testid={`open-file-${e.id}`}><Paperclip size={13} /></Button>}
                                            {e.status === 'approved' && e.balance > 0 && <Button variant="ghost" size="sm" onClick={() => { setPayOpen(e); setPay({ amount: String(e.balance), mode: 'cash', date: localDate() }); }} data-testid={`pay-${e.id}`}>Pay</Button>}
                                            {isAdmin && e.status !== 'void' && <Button variant="ghost" size="sm" className="text-slate-400 hover:text-rose-600" title="Void" onClick={() => voidBill(e)} data-testid={`void-${e.id}`}><Ban size={13} /></Button>}
                                        </td>
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

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" data-testid="expense-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">New bill</DialogTitle></DialogHeader>
                    <div className="grid grid-cols-2 gap-3 py-1">
                        <div><Label><FieldLabel required>Category</FieldLabel></Label>
                            <select className={selectCls} value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} data-testid="exp-category">
                                <option value="">Choose</option>{cats.filter(c => c.active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        <div><Label><FieldLabel required>Date</FieldLabel></Label>
                            <Input type="date" className="mt-1" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                        <div><Label><FieldLabel required>Vendor</FieldLabel></Label>
                            <Input className="mt-1" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} data-testid="exp-vendor" /></div>
                        <div><Label><FieldLabel>Bill no.</FieldLabel></Label>
                            <Input className="mt-1" value={form.bill_no} onChange={e => { setDupHint(false); setForm({ ...form, bill_no: e.target.value }); }} data-testid="exp-bill" /></div>
                        <div><Label><FieldLabel required>Amount</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: numText(e.target.value) })} data-testid="exp-amount" /></div>
                        <div><Label><FieldLabel>GST</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={form.gst_amount} onChange={e => setForm({ ...form, gst_amount: numText(e.target.value) })} data-testid="exp-gst" /></div>
                        <div className="col-span-2 rounded-md bg-slate-50 px-3 py-1.5 text-[12.5px]">Bill total <strong className="tnum" data-testid="exp-total">{inr(total)}</strong></div>
                        <div><Label><FieldLabel>Paid now</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={form.paid_amount} onChange={e => setForm({ ...form, paid_amount: numText(e.target.value) })} data-testid="exp-paid" /></div>
                        <div><Label><FieldLabel>Paid by</FieldLabel></Label>
                            <select className={selectCls} value={form.payment_mode} onChange={e => setForm({ ...form, payment_mode: e.target.value })}>
                                {['cash', 'upi', 'bank', 'cheque', 'other'].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                        <div><Label><FieldLabel>Charge to a lot</FieldLabel></Label>
                            <select className={selectCls} value={form.lot_id} onChange={e => setForm({ ...form, lot_id: e.target.value })}>
                                <option value="">General overhead</option>{lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} · {l.style_name}</option>)}</select></div>
                        <div><Label><FieldLabel>Machine / area</FieldLabel></Label>
                            <Input className="mt-1" value={form.machine_ref} onChange={e => setForm({ ...form, machine_ref: e.target.value })} placeholder="e.g. Overlock #3" /></div>
                        <div className="col-span-2"><Label><FieldLabel>What was it for</FieldLabel></Label>
                            <Input className="mt-1" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                        <div className="col-span-2"><Label><FieldLabel>Bill photo or PDF (max 5 MB)</FieldLabel></Label>
                            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="mt-1 block w-full text-[12.5px]"
                                onChange={e => setFile(e.target.files?.[0] || null)} data-testid="exp-file" /></div>
                        {dupHint && (
                            <div className="col-span-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2.5">
                                <p className="text-[12px] text-amber-800">This vendor and bill number are already recorded. If it really is a second bill, say why.</p>
                                <Input value={form.duplicate_reason} placeholder="Why is this a second bill?"
                                    onChange={e => setForm({ ...form, duplicate_reason: e.target.value, allow_duplicate: !!e.target.value.trim() })} data-testid="exp-dup-reason" />
                            </div>
                        )}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={save} data-testid="save-expense">Save bill</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!payOpen} onOpenChange={() => setPayOpen(null)}>
                <DialogContent className="sm:max-w-sm" data-testid="pay-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Pay {payOpen?.voucher_no}</DialogTitle></DialogHeader>
                    <p className="text-[12.5px] text-slate-500">{payOpen?.vendor} · still owed {payOpen && inr(payOpen.balance)}</p>
                    <div className="space-y-3">
                        <div><Label><FieldLabel required>Amount</FieldLabel></Label>
                            <Input className="mt-1 font-mono" inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: numText(e.target.value) })} data-testid="pay-amount" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><Label><FieldLabel>Paid by</FieldLabel></Label><select className={selectCls} value={pay.mode} onChange={e => setPay({ ...pay, mode: e.target.value })}>
                                {['cash', 'upi', 'bank', 'cheque', 'other'].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                            <div><Label><FieldLabel>Date</FieldLabel></Label><Input type="date" className="mt-1" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></div>
                        </div>
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setPayOpen(null)}>Cancel</Button><Button onClick={doPay} data-testid="pay-save">Record payment</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogContent className="sm:max-w-sm" data-testid="category-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Expense categories</DialogTitle></DialogHeader>
                    <div className="flex gap-2"><Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="e.g. Service, Maintenance, Accessories"
                        onKeyDown={e => e.key === 'Enter' && addCat()} data-testid="new-category" /><Button onClick={addCat} data-testid="add-category"><Plus size={14} /> Add</Button></div>
                    <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {cats.map(c => <li key={c.id} className="px-3 py-2 text-[13px]">{c.name}</li>)}
                        {cats.length === 0 && <li className="px-3 py-5 text-center text-[12.5px] text-slate-400">No categories yet.</li>}
                    </ul>
                </DialogContent>
            </Dialog>
        </div>
    );
}
