import { useEffect, useState } from 'react';
import api from '../lib/api';
import { localDate } from '../lib/utils';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Plus, Trash2, Eye, Printer, Wallet } from 'lucide-react';
import {
    PageHeader, Panel, StatCard, EmptyState, Pill, inr, num, FieldLabel,
} from '../components/ui/primitives';

const inr0 = (n) => (Number(n) || 0).toLocaleString('en-IN',
    { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const LOGO = "/victoria-logo-color.svg";
const CO = { name: "Victoria Garments", address: "317/4b,4c,Sri Nagar, Kumarasamy Nagar (East), Pitchampalayam Pudur (PO), Tiruppur - 641603", phone: "0421-2479137", email: "info@victoriagarments.in" };

export default function AdvancesPage() {
    const [advances, setAdvances] = useState([]);
    const [operators, setOperators] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [voucherPreview, setVoucherPreview] = useState(null);
    const [form, setForm] = useState({ operator_id: '', date: localDate(), amount: '', remarks: '' });
    const [filterOp, setFilterOp] = useState('all');

    const load = () => {
        const q = filterOp && filterOp !== 'all' ? `?operator_id=${filterOp}` : '';
        api.get(`/advances${q}`).then(r => setAdvances(r.data)).catch(() => toast.error('Failed to load'));
    };
    useEffect(() => { api.get('/operators').then(r => setOperators(r.data.filter(o => o.active))); }, []);
    useEffect(() => { load(); }, [filterOp]);

    const handleCreate = async () => {
        if (!form.operator_id || !form.amount) return toast.error('Operator and amount required');
        try {
            await api.post('/advances', { ...form, amount: parseFloat(form.amount) });
            toast.success('Advance recorded');
            setDialogOpen(false); setForm({ operator_id: '', date: localDate(), amount: '', remarks: '' }); load();
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
    };

    // Adjust functionality removed - now handled in Payroll page

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this advance?')) return;
        await api.delete(`/advances/${id}`); toast.success('Deleted'); load();
    };

    const statusColors = { pending: 'bg-amber-50 text-amber-700', partially_adjusted: 'bg-blue-50 text-blue-700', fully_adjusted: 'bg-emerald-50 text-emerald-700' };

    return (
        <div className="space-y-4" data-testid="advances-page">
            <PageHeader
                title="Advances"
                subtitle="Cash paid out ahead of wages, recovered through payroll oldest-first"
                icon={Wallet}
                actions={
                    <Button onClick={() => setDialogOpen(true)} data-testid="add-advance-button">
                        <Plus size={15} /> Record advance
                    </Button>
                }
            />

            <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard i={0} label="Vouchers" value={advances.length} tone="brand" sub="in view" />
                <StatCard i={1} label="Total advanced" tone="slate" format={inr0}
                    value={advances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0)} sub="lifetime" />
                <StatCard i={2} label="Outstanding" tone="amber" format={inr0}
                    value={advances.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)} sub="still to recover" />
                <StatCard i={3} label="Fully cleared" tone="leaf"
                    value={advances.filter(a => a.status === 'fully_adjusted').length} sub="vouchers settled" />
            </div>

            <Panel bodyClass="p-0">
                <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-3.5 py-2.5">
                    <div>
                        <Label className="mb-1 block"><FieldLabel>Filter by operator</FieldLabel></Label>
                        <Select value={filterOp} onValueChange={setFilterOp}>
                            <SelectTrigger className="h-8 w-60 text-[12.5px]" data-testid="advance-filter">
                                <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All operators</SelectItem>
                                {operators.map(o => <SelectItem key={o.id} value={o.id}>{o.name} ({o.operator_code})</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <span className="tnum ml-auto pb-1.5 text-[11.5px] text-muted-foreground">
                        {advances.length} {advances.length === 1 ? 'voucher' : 'vouchers'}
                    </span>
                </div>
                <div>
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Voucher #</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Date</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Operator</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 text-right">Amount</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 text-right">Balance</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</TableHead>
                                <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {advances.map(a => (
                                <TableRow key={a.id} className="hover:bg-slate-50/80" data-testid={`advance-row-${a.id}`}>
                                    <TableCell className="text-xs font-mono font-semibold text-blue-600">{a.voucher_number || '-'}</TableCell>
                                    <TableCell className="text-xs font-mono">{a.date}</TableCell>
                                    <TableCell className="text-xs font-medium">{a.operator_name} ({a.operator_code})</TableCell>
                                    <TableCell className="text-xs font-mono text-right">{parseFloat(a.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                                    <TableCell className="text-xs font-mono text-right font-semibold text-amber-700">{parseFloat(a.balance).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                                    <TableCell><Badge className={`text-[10px] ${statusColors[a.status] || ''}`}>{a.status?.replace('_', ' ')}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" size="sm" onClick={() => setVoucherPreview(a)} className="text-blue-600 gap-1 text-[10px] h-6" data-testid={`view-adv-${a.id}`}>
                                                <Eye size={11} /> View
                                            </Button>
                                            <Button variant="ghost" size="sm" aria-label={`Delete advance ${a.voucher_number}`} onClick={() => handleDelete(a.id)} className="text-red-500" data-testid={`delete-adv-${a.id}`}>
                                                <Trash2 size={14} />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {advances.length === 0 && (
                                <TableRow><TableCell colSpan={7} className="p-0">
                                    <EmptyState compact icon={Wallet} title="No advances recorded"
                                        message="Record a cash advance and it will be recovered automatically through payroll." />
                                </TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </Panel>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md" data-testid="advance-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Record Advance</DialogTitle></DialogHeader>
                    <div className="space-y-3 py-2">
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operator</Label>
                            <Select value={form.operator_id} onValueChange={v => setForm({ ...form, operator_id: v })}>
                                <SelectTrigger className="mt-1" data-testid="adv-operator"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>{operators.map(o => <SelectItem key={o.id} value={o.id}>{o.name} ({o.operator_code})</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Date</Label>
                                <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="mt-1" data-testid="adv-date" />
                            </div>
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</Label>
                                <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1 font-mono" min="0" data-testid="adv-amount" />
                            </div>
                        </div>
                        <div>
                            <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Remarks</Label>
                            <Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} className="mt-1" data-testid="adv-remarks" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} data-testid="save-advance">Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!voucherPreview} onOpenChange={() => setVoucherPreview(null)}>
                <DialogContent className="sm:max-w-md" data-testid="advance-voucher-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Advance Voucher</DialogTitle></DialogHeader>
                    {voucherPreview && (
                        <div className="space-y-3" id="advance-voucher-print">
                            <div className="flex items-center gap-3 border-b pb-2">
                                <img src={LOGO} alt="Victoria" className="h-8 object-contain" />
                                <div>
                                    <p className="text-xs font-bold text-slate-800">{CO.name}</p>
                                    <p className="text-[8px] text-slate-500">{CO.address}</p>
                                    <p className="text-[8px] text-slate-500">Ph: {CO.phone} | {CO.email}</p>
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Advance Voucher</p>
                                <p className="text-[10px] font-mono text-slate-600">{voucherPreview.voucher_number}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs border border-slate-200 rounded p-3">
                                <div><span className="text-slate-500">Operator:</span> <b>{voucherPreview.operator_name} ({voucherPreview.operator_code})</b></div>
                                <div><span className="text-slate-500">Date:</span> <b className="font-mono">{voucherPreview.date}</b></div>
                                <div><span className="text-slate-500">Amount:</span> <b className="font-mono text-blue-700">{parseFloat(voucherPreview.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</b></div>
                                <div><span className="text-slate-500">Balance:</span> <b className="font-mono text-amber-700">{parseFloat(voucherPreview.balance).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</b></div>
                                {voucherPreview.remarks && <div className="col-span-2"><span className="text-slate-500">Remarks:</span> {voucherPreview.remarks}</div>}
                            </div>
                            <div className="flex justify-between pt-4 text-xs text-slate-500 border-t">
                                <span>Received By: _____________</span><span>Authorized: _____________</span>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1"><Printer size={14} /> Print</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
