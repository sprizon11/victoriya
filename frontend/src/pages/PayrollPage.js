import { useEffect, useState } from 'react';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import {
    ChevronDown, ChevronRight, Download, Printer, IndianRupee, Wallet,
    FileSpreadsheet, AlertTriangle, Info,
} from 'lucide-react';
import {
    PageHeader, Panel, StatCard, EmptyState, Pill, SkeletonRows, inr, num, FieldLabel,
} from '../components/ui/primitives';

const inr0 = (n) => (Number(n) || 0).toLocaleString('en-IN',
    { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function PayrollPage() {
    const [weeks, setWeeks] = useState([]);
    const [weekId, setWeekId] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState({});
    const [adjustDialog, setAdjustDialog] = useState(null);
    const [adjustAmt, setAdjustAmt] = useState('');
    const [adjustVoucher, setAdjustVoucher] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => { api.get('/weeks').then(r => setWeeks(r.data)).catch(() => {}); }, []);

    const selectedWeek = weeks.find(w => w.id === weekId);

    const loadPayroll = async () => {
        if (!selectedWeek) return toast.error('Select a week first');
        setLoading(true);
        try {
            const r = await api.get(`/payroll/weekly?week=${selectedWeek.week_number}&year=${selectedWeek.year}`);
            setData(r.data);
        } catch { toast.error('Could not load payroll'); }
        finally { setLoading(false); }
    };

    const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

    const openAdjust = (op) => {
        setAdjustDialog(op);
        // pre-fill with what payroll says is recoverable this week
        setAdjustAmt(op.advance_deducted ? String(op.advance_deducted) : '');
        setAdjustVoucher(op.advances?.[0]?.id || '');
    };

    const handleAdjust = async () => {
        const amt = parseFloat(adjustAmt);
        if (!amt || amt <= 0) return toast.error('Enter an amount greater than zero');
        if (amt > (adjustDialog?.advance_outstanding ?? 0)) {
            return toast.error('Amount is more than the outstanding balance');
        }
        setSaving(true);
        try {
            await api.post('/payroll/adjust-advance', {
                operator_id: adjustDialog?.operator_id,
                advance_id: adjustVoucher || null,
                amount: amt,
                week_number: selectedWeek?.week_number, year: selectedWeek?.year,
            });
            toast.success(`${inr(amt)} adjusted for ${adjustDialog.operator_name}`);
            setAdjustDialog(null); setAdjustAmt(''); loadPayroll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Adjustment failed');
        } finally { setSaving(false); }
    };

    const exportExcel = async () => {
        if (!selectedWeek) return;
        try {
            await downloadFile(
                `/api/reports/export/excel?report_type=salary&week=${selectedWeek.week_number}&year=${selectedWeek.year}`,
                `salary_W${selectedWeek.week_number}_${selectedWeek.year}.xlsx`);
            toast.success('Salary sheet downloaded');
        } catch { toast.error('Export failed'); }
    };
    const exportPdf = async () => {
        if (!selectedWeek) return;
        try {
            await downloadFile(
                `/api/reports/export/pdf?report_type=salary&week=${selectedWeek.week_number}&year=${selectedWeek.year}`,
                `salary_W${selectedWeek.week_number}_${selectedWeek.year}.pdf`);
            toast.success('Salary report downloaded');
        } catch { toast.error('Export failed'); }
    };

    const carried = data?.operators?.reduce((s, o) => s + (o.advance_carried || 0), 0) || 0;

    return (
        <div className="space-y-4" data-testid="payroll-page">
            <PageHeader
                title="Payroll"
                subtitle="Weekly piece-rate wages, after advance recovery"
                icon={IndianRupee}
                actions={data && (
                    <>
                        <Button variant="outline" size="sm" onClick={() => window.print()}>
                            <Printer size={14} /> Print
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportExcel}>
                            <FileSpreadsheet size={14} /> Excel
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportPdf}>
                            <Download size={14} /> PDF
                        </Button>
                    </>
                )}
            />

            <Panel bodyClass="p-3.5">
                <div className="flex flex-wrap items-end gap-2.5">
                    <div className="min-w-[290px] flex-1 sm:flex-none">
                        <Label className="mb-1 block"><FieldLabel required>Payroll week</FieldLabel></Label>
                        <Select value={weekId} onValueChange={setWeekId}>
                            <SelectTrigger data-testid="payroll-week-select">
                                <SelectValue placeholder="Select a week" />
                            </SelectTrigger>
                            <SelectContent>
                                {weeks.map(w => (
                                    <SelectItem key={w.id} value={w.id}>
                                        Week {w.week_number} · {w.start_date} to {w.end_date}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={loadPayroll} loading={loading} data-testid="load-payroll">
                        {loading ? 'Loading…' : 'Load payroll'}
                    </Button>
                </div>
            </Panel>

            {loading && (
                <Panel bodyClass="p-0"><SkeletonRows rows={8} cols={6} /></Panel>
            )}

            {!loading && data && (
                <>
                    <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <StatCard i={0} label="Gross wages" value={data.grand_total} format={inr0}
                            icon={IndianRupee} tone="brand" sub={`${data.operators.length} operators`} />
                        <StatCard i={1} label="Advance recovered" value={data.total_advances} format={inr0}
                            icon={Wallet} tone="amber" sub="deducted this week" />
                        <StatCard i={2} label="Net payable" value={data.net_total} format={inr0}
                            icon={IndianRupee} tone="leaf" sub="cash to disburse" />
                        <StatCard i={3} label="Still outstanding" value={carried} format={inr0}
                            icon={AlertTriangle} tone={carried > 0 ? 'rose' : 'slate'}
                            sub="carried to next week" />
                    </div>

                    <Panel
                        className="print-full"
                        title={`Salary sheet — week ${data.week_number}, ${data.year}`}
                        subtitle="Tap a row to see the operation-wise breakdown"
                        bodyClass="p-0"
                    >
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead>
                                    <tr className="border-b border-border bg-slate-50/90">
                                        <th className="w-8" />
                                        <th className="px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Operator</th>
                                        <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Qty</th>
                                        <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gross</th>
                                        <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Advance</th>
                                        <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Net payable</th>
                                        <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground print:hidden">Adjust</th>
                                    </tr>
                                </thead>
                                <tbody className="stagger-fast">
                                    {data.operators.map((op, i) => (
                                        <OpRow
                                            key={op.operator_id} op={op} i={i}
                                            expanded={!!expanded[op.operator_id]}
                                            onToggle={() => toggleExpand(op.operator_id)}
                                            onAdjust={() => openAdjust(op)}
                                        />
                                    ))}
                                    {data.operators.length === 0 && (
                                        <tr><td colSpan={7}>
                                            <EmptyState compact icon={IndianRupee}
                                                title="No payroll for this week"
                                                message="No production was recorded in the selected week." />
                                        </td></tr>
                                    )}
                                </tbody>
                                {data.operators.length > 0 && (
                                    <tfoot>
                                        <tr className="border-t-2 border-brand/20 bg-brand-50/60 font-semibold">
                                            <td />
                                            <td className="px-2.5 py-2.5 text-[12px] uppercase tracking-wide text-slate-700">Total</td>
                                            <td className="tnum px-2.5 py-2.5 text-right">
                                                {num(data.operators.reduce((s, o) => s + o.total_quantity, 0))}
                                            </td>
                                            <td className="tnum px-2.5 py-2.5 text-right">{inr(data.grand_total)}</td>
                                            <td className="tnum px-2.5 py-2.5 text-right text-amber-700">
                                                −{inr(data.total_advances)}
                                            </td>
                                            <td className="tnum px-2.5 py-2.5 text-right text-[14px] text-leaf">
                                                {inr(data.net_total)}
                                            </td>
                                            <td className="print:hidden" />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        <div className="flex items-start gap-2 border-t border-border bg-slate-50/70 px-4 py-2.5 print:hidden">
                            <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
                            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                                Advance recovery is capped at what the operator earned this week, so net pay
                                is never negative. Anything not recovered stays outstanding and carries forward.
                                The Excel, PDF and printed voucher all show these same net figures.
                            </p>
                        </div>
                    </Panel>
                </>
            )}

            {!loading && !data && (
                <Panel bodyClass="p-0">
                    <EmptyState
                        icon={IndianRupee}
                        title="Select a week to begin"
                        message="Choose a payroll week above and load it to see gross wages, advance recovery and net payable for every operator."
                    />
                </Panel>
            )}

            {/* -------------------------------------------------- adjust dialog */}
            <Dialog open={!!adjustDialog} onOpenChange={() => setAdjustDialog(null)}>
                <DialogContent className="sm:max-w-md" data-testid="payroll-adjust-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-outfit">
                            Adjust advance — {adjustDialog?.operator_name}
                        </DialogTitle>
                    </DialogHeader>
                    {adjustDialog && (
                        <div className="space-y-3.5 py-1">
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    ['Outstanding', adjustDialog.advance_outstanding, 'text-amber-700'],
                                    ['Deducting', parseFloat(adjustAmt) || 0, 'text-rose-600'],
                                    ['Remaining', (adjustDialog.advance_outstanding || 0) - (parseFloat(adjustAmt) || 0), 'text-brand'],
                                ].map(([label, val, tone]) => (
                                    <div key={label} className="rounded-lg bg-slate-50 p-2 text-center ring-1 ring-inset ring-border">
                                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                                        <p className={`tnum mt-0.5 text-[13px] font-semibold ${tone}`}>{inr0(val)}</p>
                                    </div>
                                ))}
                            </div>

                            {adjustDialog.advances?.length > 1 && (
                                <div>
                                    <Label className="mb-1 block"><FieldLabel>Apply to voucher</FieldLabel></Label>
                                    <Select value={adjustVoucher} onValueChange={setAdjustVoucher}>
                                        <SelectTrigger><SelectValue placeholder="Oldest first" /></SelectTrigger>
                                        <SelectContent>
                                            {adjustDialog.advances.map(a => (
                                                <SelectItem key={a.id} value={a.id}>
                                                    {a.voucher_number} · {a.date} · balance {inr0(a.balance)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        The chosen voucher is cleared first; anything left over rolls onto the older ones.
                                    </p>
                                </div>
                            )}

                            <div>
                                <Label className="mb-1 block"><FieldLabel required>Deduction amount</FieldLabel></Label>
                                <Input
                                    type="number" value={adjustAmt} min="0" step="0.01"
                                    max={adjustDialog.advance_outstanding}
                                    onChange={e => setAdjustAmt(e.target.value)}
                                    className="font-mono" autoFocus
                                    data-testid="payroll-adjust-amount"
                                />
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    Week {selectedWeek?.week_number} ({selectedWeek?.start_date} to {selectedWeek?.end_date}).
                                    Earned this week: <span className="tnum font-medium">{inr0(adjustDialog.total_earnings)}</span>
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjustDialog(null)}>Cancel</Button>
                        <Button onClick={handleAdjust} loading={saving} data-testid="confirm-payroll-adjust">
                            Confirm adjustment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function OpRow({ op, expanded, onToggle, onAdjust, i }) {
    return (
        <>
            <tr
                style={{ '--i': i }}
                onClick={onToggle}
                className="cursor-pointer border-b border-border/60 transition-colors duration-150 hover:bg-brand-50/50"
                data-testid={`payroll-op-${op.operator_id}`}
            >
                <td className="pl-2.5 text-slate-400">
                    <ChevronRight size={14}
                        className={`transition-transform duration-200 ease-out-soft ${expanded ? 'rotate-90' : ''}`} />
                </td>
                <td className="px-2.5 py-2">
                    <span className="text-[13px] font-medium text-slate-800">{op.operator_name}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-slate-400">{op.operator_code}</span>
                    {op.advance_carried > 0 && (
                        <Pill tone="rose" className="ml-2">
                            {inr0(op.advance_carried)} due
                        </Pill>
                    )}
                </td>
                <td className="tnum px-2.5 py-2 text-right text-slate-600">{num(op.total_quantity)}</td>
                <td className="tnum px-2.5 py-2 text-right font-medium">{inr(op.total_earnings)}</td>
                <td className="tnum px-2.5 py-2 text-right text-amber-700">
                    {op.advance_deducted ? `−${inr(op.advance_deducted)}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="tnum px-2.5 py-2 text-right font-semibold text-leaf">{inr(op.net_salary)}</td>
                <td className="px-2.5 py-2 text-right print:hidden">
                    {op.advance_outstanding > 0 && (
                        <Button
                            variant="subtle" size="xs"
                            onClick={e => { e.stopPropagation(); onAdjust(); }}
                            data-testid={`adjust-adv-${op.operator_id}`}
                        >
                            <IndianRupee size={10} /> Adjust
                        </Button>
                    )}
                </td>
            </tr>
            {expanded && op.operations?.map(o => (
                <tr key={o.operation_name} className="border-b border-border/40 bg-slate-50/60">
                    <td />
                    <td className="py-1.5 pl-7 pr-2.5 text-[11.5px] text-muted-foreground">{o.operation_name}</td>
                    <td className="tnum py-1.5 pr-2.5 text-right text-[11.5px] text-muted-foreground">
                        {num(o.quantity)} <span className="text-slate-400">@ {o.rate}</span>
                    </td>
                    <td className="tnum py-1.5 pr-2.5 text-right text-[11.5px] text-slate-600">{inr(o.earnings)}</td>
                    <td colSpan={3} />
                </tr>
            ))}
        </>
    );
}
