import { useState, useEffect } from 'react';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Download, FileText, Eye, Printer, Receipt } from 'lucide-react';
import {
    PageHeader, Panel, StatCard, EmptyState, Pill, SkeletonRows, inr, num, FieldLabel,
} from '../components/ui/primitives';

const LOGO = "/victoria-logo-mark.png";
const COMPANY = {
    name: "Victoria Garments",
    address: "317/4b,4c,Sri Nagar, Kumarasamy Nagar (East), Pitchampalayam Pudur (PO), Tiruppur - 641603",
    phone: "0421-2479137",
    email: "info@victoriagarments.in",
};

const inr0 = (n) => (Number(n) || 0).toLocaleString('en-IN',
    { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function VouchersPage() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [previewOp, setPreviewOp] = useState(null);
    const [allWeeks, setAllWeeks] = useState([]);
    const [weekId, setWeekId] = useState('');

    useEffect(() => { api.get('/weeks').then(r => setAllWeeks(r.data)).catch(() => {}); }, []);

    const selectedWeek = allWeeks.find(w => w.id === weekId);

    const loadVouchers = async () => {
        if (!selectedWeek) return toast.error('Select a week first');
        setLoading(true);
        try {
            const r = await api.get(`/vouchers?week=${selectedWeek.week_number}&year=${selectedWeek.year}`);
            setData(r.data);
        } catch { toast.error('Could not load vouchers'); }
        finally { setLoading(false); }
    };

    const downloadVoucher = async (operatorId, name) => {
        if (!selectedWeek) return;
        try {
            await downloadFile(
                `/api/reports/export/pdf?report_type=voucher&operator_id=${operatorId}&week=${selectedWeek.week_number}&year=${selectedWeek.year}`,
                `voucher_${(name || 'operator').replace(/\s+/g, '_')}_W${selectedWeek.week_number}.pdf`);
            toast.success('Voucher downloaded');
        } catch { toast.error('Download failed'); }
    };

    return (
        <div className="space-y-4" data-testid="vouchers-page">
            <PageHeader
                title="Payment vouchers"
                subtitle="One voucher per operator, showing gross wages less advance recovery"
                icon={Receipt}
            />

            <Panel bodyClass="p-3.5">
                <div className="flex flex-wrap items-end gap-2.5">
                    <div className="min-w-[290px] flex-1 sm:flex-none">
                        <Label className="mb-1 block"><FieldLabel required>Week</FieldLabel></Label>
                        <Select value={weekId} onValueChange={setWeekId}>
                            <SelectTrigger data-testid="voucher-week-select">
                                <SelectValue placeholder="Select a week" />
                            </SelectTrigger>
                            <SelectContent>
                                {allWeeks.map(w => (
                                    <SelectItem key={w.id} value={w.id}>
                                        Week {w.week_number} · {w.start_date} to {w.end_date}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Button onClick={loadVouchers} loading={loading} data-testid="load-vouchers">
                        {loading ? 'Loading…' : 'Load vouchers'}
                    </Button>
                </div>
            </Panel>

            {loading && <Panel bodyClass="p-0"><SkeletonRows rows={7} cols={6} /></Panel>}

            {!loading && data && (
                <>
                    <div className="stagger grid grid-cols-3 gap-3">
                        <StatCard i={0} label="Vouchers" value={data.operators?.length || 0}
                            icon={Receipt} tone="brand" sub={`week ${data.week_number}`} />
                        <StatCard i={1} label="Gross" value={data.grand_total} format={inr0}
                            icon={FileText} tone="slate" sub="before advances" />
                        <StatCard i={2} label="Total payable" value={data.net_total} format={inr0}
                            icon={Download} tone="leaf" sub="cash to disburse" />
                    </div>

                    <Panel
                        title={`Week ${data.week_number}, ${data.year}`}
                        subtitle="Voucher numbers are issued once and stay the same on every reprint"
                        bodyClass="p-0"
                    >
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead>
                                    <tr className="border-b border-border bg-slate-50/90">
                                        {['#', 'Operator', 'Qty', 'Gross', 'Advance', 'Net payable', ''].map((h, i) => (
                                            <th key={h + i}
                                                className={`px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground
                                                    ${i >= 2 && i <= 5 ? 'text-right' : i === 6 ? 'text-right' : 'text-left'}`}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="stagger-fast">
                                    {data.operators?.map((op, i) => (
                                        <tr key={op.operator_id} style={{ '--i': i }}
                                            className="border-b border-border/60 transition-colors duration-150 hover:bg-brand-50/50"
                                            data-testid={`voucher-row-${op.operator_id}`}>
                                            <td className="tnum px-2.5 py-2 text-[11px] text-slate-400">{i + 1}</td>
                                            <td className="px-2.5 py-2">
                                                <span className="text-[13px] font-medium text-slate-800">{op.operator_name}</span>
                                                <span className="ml-1.5 font-mono text-[10px] text-slate-400">{op.operator_code}</span>
                                                {op.advance_carried > 0 && (
                                                    <Pill tone="rose" className="ml-2">{inr0(op.advance_carried)} due</Pill>
                                                )}
                                            </td>
                                            <td className="tnum px-2.5 py-2 text-right text-slate-600">{num(op.total_quantity)}</td>
                                            <td className="tnum px-2.5 py-2 text-right">{inr(op.total_earnings)}</td>
                                            <td className="tnum px-2.5 py-2 text-right text-amber-700">
                                                {op.advance_deducted ? `−${inr(op.advance_deducted)}` : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="tnum px-2.5 py-2 text-right font-semibold text-leaf">{inr(op.net_salary)}</td>
                                            <td className="px-2.5 py-2 text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="outline" size="xs" onClick={() => setPreviewOp(op)}
                                                        data-testid={`preview-voucher-${op.operator_id}`}>
                                                        <Eye size={11} /> View
                                                    </Button>
                                                    <Button variant="outline" size="xs"
                                                        onClick={() => downloadVoucher(op.operator_id, op.operator_name)}
                                                        data-testid={`download-voucher-${op.operator_id}`}>
                                                        <FileText size={11} /> PDF
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {(!data.operators || data.operators.length === 0) && (
                                        <tr><td colSpan={7}>
                                            <EmptyState compact icon={Receipt} title="No vouchers for this week"
                                                message="Vouchers are generated from production recorded in the selected week." />
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Panel>
                </>
            )}

            {!loading && !data && (
                <Panel bodyClass="p-0">
                    <EmptyState icon={Receipt} title="Select a week"
                        message="Pick a payroll week above to generate payment vouchers for every operator." />
                </Panel>
            )}

            {/* ------------------------------------------------ voucher preview */}
            <Dialog open={!!previewOp} onOpenChange={() => setPreviewOp(null)}>
                <DialogContent className="sm:max-w-lg" data-testid="voucher-preview-dialog">
                    <DialogHeader><DialogTitle className="font-outfit">Payment voucher</DialogTitle></DialogHeader>
                    {previewOp && (
                        <div className="space-y-3" id="voucher-content">
                            <div className="flex items-center gap-3 border-b border-border pb-3">
                                <img src={LOGO} alt="Victoria" className="h-9 object-contain" />
                                <div className="min-w-0">
                                    <p className="text-[13px] font-bold text-slate-800">{COMPANY.name}</p>
                                    <p className="text-[9px] leading-snug text-slate-500">{COMPANY.address}</p>
                                    <p className="text-[9px] text-slate-500">Ph: {COMPANY.phone} · {COMPANY.email}</p>
                                </div>
                            </div>

                            <div className="rounded-lg bg-brand-50 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-brand">
                                Payment voucher · Week {data?.week_number}, {data?.year}
                            </div>

                            <p className="text-[12px]">
                                <span className="text-muted-foreground">Operator:</span>{' '}
                                <span className="font-medium text-slate-800">
                                    {previewOp.operator_name} ({previewOp.operator_code})
                                </span>
                            </p>

                            <div className="overflow-hidden rounded-lg border border-border">
                                <table className="w-full text-[12px]">
                                    <thead>
                                        <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            <th className="px-2.5 py-1.5 text-left">Operation</th>
                                            <th className="px-2.5 py-1.5 text-right">Qty</th>
                                            <th className="px-2.5 py-1.5 text-right">Rate</th>
                                            <th className="px-2.5 py-1.5 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewOp.operations?.map(o => (
                                            <tr key={o.operation_name} className="border-t border-border/60">
                                                <td className="px-2.5 py-1.5">{o.operation_name}</td>
                                                <td className="tnum px-2.5 py-1.5 text-right">{num(o.quantity)}</td>
                                                <td className="tnum px-2.5 py-1.5 text-right text-muted-foreground">{o.rate}</td>
                                                <td className="tnum px-2.5 py-1.5 text-right">{inr(o.earnings)}</td>
                                            </tr>
                                        ))}
                                        <tr className="border-t border-border bg-slate-50 font-semibold">
                                            <td className="px-2.5 py-1.5">Gross earnings</td>
                                            <td className="tnum px-2.5 py-1.5 text-right">{num(previewOp.total_quantity)}</td>
                                            <td />
                                            <td className="tnum px-2.5 py-1.5 text-right">{inr(previewOp.total_earnings)}</td>
                                        </tr>
                                        {previewOp.advance_deducted > 0 && (
                                            <tr className="border-t border-border/60 text-amber-700">
                                                <td className="px-2.5 py-1.5" colSpan={3}>Less: advance recovered this week</td>
                                                <td className="tnum px-2.5 py-1.5 text-right">−{inr(previewOp.advance_deducted)}</td>
                                            </tr>
                                        )}
                                        <tr className="border-t-2 border-leaf/30 bg-leaf/10 font-bold">
                                            <td className="px-2.5 py-2" colSpan={3}>Net payable</td>
                                            <td className="tnum px-2.5 py-2 text-right">{inr(previewOp.net_salary)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {previewOp.advance_carried > 0 && (
                                <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 ring-1 ring-inset ring-amber-200">
                                    Advance still outstanding after this week:{' '}
                                    <span className="tnum font-semibold">{inr(previewOp.advance_carried)}</span>
                                </p>
                            )}

                            <div className="flex justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
                                <span>Signature: _____________</span>
                                <span>Date: _____________</span>
                            </div>
                        </div>
                    )}
                    <div className="mt-1 flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => window.print()}>
                            <Printer size={13} /> Print
                        </Button>
                        {previewOp && (
                            <Button size="sm" onClick={() => downloadVoucher(previewOp.operator_id, previewOp.operator_name)}>
                                <Download size={13} /> Download PDF
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
