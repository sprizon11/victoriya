import React, { useEffect, useState } from 'react';
import api, { downloadFile } from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { PageHeader } from '../components/ui/primitives';
import { FileSpreadsheet, FileText, Eye, Printer, FileBarChart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const LOGO = "/victoria-logo-mark.png";
const CO = { name: "Victoria Garments", address: "317/4b,4c,Sri Nagar, Kumarasamy Nagar (East), Pitchampalayam Pudur (PO), Tiruppur - 641603", phone: "0421-2479137", email: "info@victoriagarments.in" };

export default function ReportsPage() {
    const { user } = useAuth();
    const [lots, setLots] = useState([]);
    const [operators, setOperators] = useState([]);
    const [weeks, setWeeks] = useState([]);
    const [colorsMaster, setColorsMaster] = useState([]);
    const [reportType, setReportType] = useState('lot_matrix');
    const [lotId, setLotId] = useState('');
    const [operatorId, setOperatorId] = useState('');
    const [weekId, setWeekId] = useState('');
    const [colorFilter, setColorFilter] = useState('');
    const [opFilter, setOpFilter] = useState('');
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [costView, setCostView] = useState('cost_production');

    useEffect(() => {
        api.get('/lots').then(r => setLots(r.data)).catch(() => {});
        api.get('/operators').then(r => setOperators(r.data)).catch(() => {});
        api.get('/weeks').then(r => setWeeks(r.data)).catch(() => {});
        api.get('/colors').then(r => setColorsMaster(r.data)).catch(() => {});
    }, []);

    const selectedWeek = weeks.find(w => w.id === weekId);
    const wk = selectedWeek?.week_number;
    const yr = selectedWeek?.year;

    const loadPreview = async () => {
        setLoading(true);
        try {
            let data;
            if (reportType === 'lot_matrix' && lotId) {
                data = (await api.get(`/reports/lot-matrix/${lotId}`)).data;
            } else if (reportType === 'weekly_matrix' && wk) {
                let url = `/reports/weekly-matrix?week=${wk}&year=${yr}`;
                if (colorFilter) url += `&color=${colorFilter}`;
                if (opFilter) url += `&operation=${opFilter}`;
                data = (await api.get(url)).data;
            } else if (reportType === 'lot_color' && lotId) {
                data = (await api.get(`/reports/lot-color/${lotId}`)).data;
            } else if (reportType === 'lot_operation' && lotId) {
                data = (await api.get(`/reports/lot-operation/${lotId}`)).data;
            } else if (reportType === 'salary' && wk) {
                data = (await api.get(`/payroll/weekly?week=${wk}&year=${yr}`)).data;
            } else if (reportType === 'operator_detail' && operatorId) {
                let url = `/reports/operator-detail/${operatorId}?year=${yr || new Date().getFullYear()}`;
                if (wk) url += `&week=${wk}`;
                if (lotId) url += `&lot_id=${lotId}`;
                if (colorFilter) url += `&color=${colorFilter}`;
                data = (await api.get(url)).data;
            } else if (reportType === 'advance_report') {
                let url = `/reports/advance-report?`;
                if (wk) url += `week=${wk}&`;
                if (yr) url += `year=${yr}`;
                data = (await api.get(url)).data;
            } else { toast.error('Select required filters'); setLoading(false); return; }
            setPreview({ type: reportType, data });
        } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
        finally { setLoading(false); }
    };

    const handlePrint = () => window.print();
    const handleExcel = () => {
        let url = `/api/reports/export/excel?report_type=lot&lot_id=${lotId}`;
        if (wk) url = `/api/reports/export/excel?report_type=salary&week=${wk}&year=${yr}`;
        if (reportType === 'lot_operation') url = `/api/reports/export/excel?report_type=operation_cost&lot_id=${lotId}`;
        downloadFile(url, 'report.xlsx').catch(() => toast.error('Failed'));
    };
    const handlePdf = () => {
        let url = `/api/reports/export/pdf?report_type=salary&week=${wk}&year=${yr}`;
        downloadFile(url, 'report.pdf').catch(() => toast.error('Failed'));
    };

    const needsLot = ['lot_matrix', 'lot_color', 'lot_operation'].includes(reportType);
    const needsWeek = ['weekly_matrix', 'salary', 'operator_detail', 'advance_report'].includes(reportType);
    const needsOperator = reportType === 'operator_detail';

    return (
        <div className="space-y-4" data-testid="reports-page">
            <PageHeader title="Reports" subtitle="Production matrices, operator detail and exports" icon={FileBarChart} />

            <Card className="border-slate-200">
                <CardContent className="pt-5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                            <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Report Type</Label>
                            <Select value={reportType} onValueChange={v => { setReportType(v); setPreview(null); }}>
                                <SelectTrigger className="mt-1" data-testid="report-type-select"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="lot_matrix">Lot Production Report (Matrix)</SelectItem>
                                    <SelectItem value="weekly_matrix">Weekly Production Report (Matrix)</SelectItem>
                                    <SelectItem value="lot_color">Lot Color-wise Report</SelectItem>
                                    <SelectItem value="lot_operation">Operation Cost Report</SelectItem>
                                    <SelectItem value="salary">Weekly Salary Report</SelectItem>
                                    <SelectItem value="operator_detail">Operator Detail Report</SelectItem>
                                    <SelectItem value="advance_report">Weekly Advance Report</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {needsLot && (
                            <div>
                                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Lot</Label>
                                <Select value={lotId} onValueChange={setLotId}>
                                    <SelectTrigger className="mt-1" data-testid="report-lot"><SelectValue placeholder="Select" /></SelectTrigger>
                                    <SelectContent>{lots.map(l => <SelectItem key={l.id} value={l.id}>{l.lot_number} - {l.style_name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        {needsWeek && (
                            <div>
                                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Week</Label>
                                <Select value={weekId} onValueChange={setWeekId}>
                                    <SelectTrigger className="mt-1" data-testid="report-week-select"><SelectValue placeholder="Select week" /></SelectTrigger>
                                    <SelectContent>{weeks.map(w => <SelectItem key={w.id} value={w.id}>Week {w.week_number} ({w.start_date} - {w.end_date})</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        {needsOperator && (
                            <div>
                                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Operator</Label>
                                <Select value={operatorId} onValueChange={setOperatorId}>
                                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                                    <SelectContent>{operators.map(o => <SelectItem key={o.id} value={o.id}>{o.name} ({o.operator_code})</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        {(reportType === 'weekly_matrix' || reportType === 'lot_color' || reportType === 'operator_detail') && (
                            <div>
                                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Color Filter</Label>
                                <Select value={colorFilter || 'all'} onValueChange={v => setColorFilter(v === 'all' ? '' : v)}>
                                    <SelectTrigger className="mt-1"><SelectValue placeholder="All Colors" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Colors</SelectItem>
                                        {colorsMaster.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        {reportType === 'operator_detail' && (
                            <div>
                                <Label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Lot (Optional)</Label>
                                <Select value={lotId || 'all'} onValueChange={v => setLotId(v === 'all' ? '' : v)}>
                                    <SelectTrigger className="mt-1"><SelectValue placeholder="All Lots" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Lots</SelectItem>
                                        {lots.map(l => <SelectItem key={l.id} value={l.id}>{l.lot_number} - {l.style_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                    {reportType === 'lot_operation' && (
                        <div className="flex gap-2">
                            <Button variant={costView === 'cost_only' ? 'default' : 'outline'} size="sm" onClick={() => setCostView('cost_only')}>Cost Only (Planned)</Button>
                            <Button variant={costView === 'cost_production' ? 'default' : 'outline'} size="sm" onClick={() => setCostView('cost_production')}>Cost + Production</Button>
                        </div>
                    )}
                    <Button onClick={loadPreview} disabled={loading} data-testid="view-report">
                        <Eye size={15} /> {loading ? 'Loading...' : 'View Report'}
                    </Button>
                </CardContent>
            </Card>

            {preview && (
                <Card className="border-slate-200 print:border-0 print:shadow-none" data-testid="report-preview">
                    <CardHeader className="pb-3 flex flex-row items-center justify-between print:hidden">
                        <CardTitle className="text-base font-outfit">Report Preview</CardTitle>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1"><Printer size={14} /> Print</Button>
                            <Button variant="outline" size="sm" onClick={handleExcel} className="gap-1"><FileSpreadsheet size={14} /> Excel</Button>
                            <Button variant="outline" size="sm" onClick={handlePdf} className="gap-1"><FileText size={14} /> PDF</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="print-full">
                        <CompanyHeader />
                        {preview.type === 'lot_matrix' && <LotMatrixReport data={preview.data} />}
                        {preview.type === 'weekly_matrix' && <WeeklyMatrixReport data={preview.data} />}
                        {preview.type === 'lot_color' && <LotColorReport data={preview.data} colorFilter={colorFilter} />}
                        {preview.type === 'lot_operation' && <OperationCostReport data={preview.data} view={costView} />}
                        {preview.type === 'salary' && <SalaryReport data={preview.data} />}
                        {preview.type === 'operator_detail' && <OperatorDetailReport data={preview.data} />}
                        {preview.type === 'advance_report' && <AdvanceReport data={preview.data} />}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function CompanyHeader() {
    return (
        <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-3">
            <img src={LOGO} alt="Victoria" className="h-10 object-contain" />
            <div>
                <p className="text-sm font-bold text-slate-800">{CO.name}</p>
                <p className="text-[9px] text-slate-500">{CO.address}</p>
                <p className="text-[9px] text-slate-500">Ph: {CO.phone} | {CO.email}</p>
            </div>
        </div>
    );
}

function LotMatrixReport({ data }) {
    const { lot, sizes, operations } = data;
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-bold text-slate-800 font-outfit">Lot Production Report - {lot?.lot_number} | {lot?.style_name}</h3>
                <div className="flex gap-4 text-xs text-slate-600 mt-1">
                    <span>Planned: <b className="font-mono">{lot?.total_planned_qty}</b></span>
                    <span>Produced: <b className="font-mono text-emerald-700">{lot?.total_produced_qty}</b></span>
                    <span>Balance: <b className="font-mono text-amber-700">{lot?.balance_qty}</b></span>
                    <span>Progress: <b className="font-mono">{lot?.progress}%</b></span>
                </div>
            </div>
            {operations?.map(op => (
                <div key={op.operation_name} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-blue-50 px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-800">{op.operation_name}</span>
                        <span className="text-[10px] font-mono text-blue-600">Rate: {op.rate}/pc</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50">
                                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold text-slate-600 min-w-[80px]">Color</th>
                                    {sizes?.map(s => <th key={s} className="border-r border-b border-slate-200 px-1 py-1.5 text-center font-semibold text-slate-600 min-w-[50px]" colSpan={3}>{s}</th>)}
                                    <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold" colSpan={3}>Total</th>
                                </tr>
                                <tr className="bg-slate-50/50">
                                    <th className="border-r border-b border-slate-200"></th>
                                    {sizes?.map(s => (<React.Fragment key={s}><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-slate-400">P</th><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-emerald-500">D</th><th className="border-r border-b border-slate-200 px-1 py-0.5 text-center text-[8px] text-amber-500">B</th></React.Fragment>))}
                                    <th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-slate-400">P</th><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-emerald-500">D</th><th className="border-b border-slate-200 px-1 py-0.5 text-center text-[8px] text-amber-500">B</th>
                                </tr>
                            </thead>
                            <tbody>
                                {op.colors?.map(c => (
                                    <tr key={c.name}>
                                        <td className="border-r border-b border-slate-200 px-2 py-1 font-medium text-slate-700">{c.name}</td>
                                        {sizes?.map(s => { const d = c.sizes?.[s] || {planned:0,produced:0,balance:0}; return (<React.Fragment key={s}><td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono">{d.planned}</td><td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono text-emerald-700">{d.produced}</td><td className={`border-r border-b border-slate-200 px-1 py-1 text-center font-mono ${d.balance<=0?'text-red-600 font-bold':'text-amber-700'}`}>{d.balance}</td></React.Fragment>); })}
                                        <td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono font-semibold">{c.total_planned}</td>
                                        <td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono font-semibold text-emerald-700">{c.total_produced}</td>
                                        <td className="border-b border-slate-200 px-1 py-1 text-center font-mono font-semibold text-amber-700">{c.balance}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
    );
}

function WeeklyMatrixReport({ data }) {
    return (
        <div className="space-y-6">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Weekly Production - Week {data.week}, {data.year}</h3>
            {data.lots?.map(lot => (
                <div key={lot.lot_number} className="space-y-3">
                    <h4 className="text-xs font-bold text-blue-700">{lot.lot_number} - {lot.style_name}</h4>
                    {lot.operations?.map(op => (
                        <div key={op.operation} className="border border-slate-200 rounded overflow-x-auto">
                            <div className="bg-slate-50 px-3 py-1.5"><span className="text-[10px] font-bold">{op.operation} @ {op.rate}/pc</span></div>
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50/50">
                                    <th className="border-r border-b border-slate-200 px-2 py-1 text-left min-w-[80px]">Color</th>
                                    {lot.sizes?.map(s => <th key={s} className="border-r border-b border-slate-200 px-2 py-1 text-center min-w-[50px]">{s}</th>)}
                                    <th className="border-b border-slate-200 px-2 py-1 text-center font-bold">Total</th>
                                </tr></thead>
                                <tbody>{op.colors?.map(c => (
                                    <tr key={c.name}><td className="border-r border-b border-slate-200 px-2 py-1 font-medium">{c.name}</td>
                                    {lot.sizes?.map(s => <td key={s} className="border-r border-b border-slate-200 px-2 py-1 text-center font-mono">{c.sizes?.[s]||0}</td>)}
                                    <td className="border-b border-slate-200 px-2 py-1 text-center font-mono font-bold">{Object.values(c.sizes||{}).reduce((a,b)=>a+b,0)}</td></tr>
                                ))}</tbody>
                            </table>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function LotColorReport({ data, colorFilter }) {
    const lot = data.lot;
    const sizes = data.sizes || [];
    const colors = colorFilter ? data.colors?.filter(c => c.name === colorFilter) : data.colors;
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Lot Color-wise Report - {lot?.lot_number} | {lot?.style_name}</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs border-collapse">
                    <thead>
                        <tr className="bg-slate-50">
                            <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold min-w-[80px]">Color</th>
                            {sizes.map(s => <th key={s} className="border-r border-b border-slate-200 px-1 py-1.5 text-center font-semibold min-w-[50px]" colSpan={3}>{s}</th>)}
                            <th className="border-b border-slate-200 px-2 py-1.5 text-center font-semibold" colSpan={3}>Total</th>
                        </tr>
                        <tr className="bg-slate-50/50">
                            <th className="border-r border-b border-slate-200"></th>
                            {sizes.map(s => (<React.Fragment key={s}><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-slate-400">Plan</th><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-emerald-500">Prod</th><th className="border-r border-b border-slate-200 px-1 py-0.5 text-center text-[8px] text-amber-500">Bal</th></React.Fragment>))}
                            <th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-slate-400">Plan</th><th className="border-r border-b border-slate-100 px-1 py-0.5 text-center text-[8px] text-emerald-500">Prod</th><th className="border-b border-slate-200 px-1 py-0.5 text-center text-[8px] text-amber-500">Bal</th>
                        </tr>
                    </thead>
                    <tbody>
                        {colors?.map(c => (
                            <tr key={c.name}>
                                <td className="border-r border-b border-slate-200 px-2 py-1.5 font-medium">{c.name}</td>
                                {sizes.map(s => { const d = c.sizes?.[s]||{planned:0,produced:0,balance:0}; return (<React.Fragment key={s}><td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono">{d.planned}</td><td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono text-emerald-700">{d.produced}</td><td className={`border-r border-b border-slate-200 px-1 py-1 text-center font-mono ${d.balance<=0?'text-red-600 font-bold':'text-amber-700'}`}>{d.balance}</td></React.Fragment>); })}
                                <td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono font-semibold">{c.total_planned}</td>
                                <td className="border-r border-b border-slate-100 px-1 py-1 text-center font-mono font-semibold text-emerald-700">{c.total_produced}</td>
                                <td className="border-b border-slate-200 px-1 py-1 text-center font-mono font-semibold text-amber-700">{c.balance}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function OperationCostReport({ data, view }) {
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Operation Cost Report - {data.lot?.lot_number} | {data.lot?.style_name}</h3>
            <table className="w-full text-xs border border-slate-200">
                <thead><tr className="bg-slate-50">
                    <th className="border-r border-b border-slate-200 px-3 py-2 text-left font-semibold">Operation</th>
                    <th className="border-r border-b border-slate-200 px-3 py-2 text-right font-semibold">Rate (INR)</th>
                    {view === 'cost_only' && <th className="border-r border-b border-slate-200 px-3 py-2 text-right font-semibold">Planned Qty</th>}
                    {view === 'cost_only' && <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Planned Cost (INR)</th>}
                    {view === 'cost_production' && <th className="border-r border-b border-slate-200 px-3 py-2 text-right font-semibold">Planned Qty</th>}
                    {view === 'cost_production' && <th className="border-r border-b border-slate-200 px-3 py-2 text-right font-semibold">Planned Cost</th>}
                    {view === 'cost_production' && <th className="border-r border-b border-slate-200 px-3 py-2 text-right font-semibold">Produced Qty</th>}
                    {view === 'cost_production' && <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Produced Cost</th>}
                </tr></thead>
                <tbody>
                    {data.operations?.map(o => (
                        <tr key={o.operation} className="hover:bg-slate-50/50">
                            <td className="border-r border-b border-slate-200 px-3 py-1.5 font-medium">{o.operation}</td>
                            <td className="border-r border-b border-slate-200 px-3 py-1.5 text-right font-mono">{o.rate}</td>
                            {view === 'cost_only' && <td className="border-r border-b border-slate-200 px-3 py-1.5 text-right font-mono">{o.planned_qty}</td>}
                            {view === 'cost_only' && <td className="border-b border-slate-200 px-3 py-1.5 text-right font-mono font-semibold">{o.planned_cost?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>}
                            {view === 'cost_production' && <td className="border-r border-b border-slate-200 px-3 py-1.5 text-right font-mono">{o.planned_qty}</td>}
                            {view === 'cost_production' && <td className="border-r border-b border-slate-200 px-3 py-1.5 text-right font-mono">{o.planned_cost?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>}
                            {view === 'cost_production' && <td className="border-r border-b border-slate-200 px-3 py-1.5 text-right font-mono text-emerald-700">{o.produced_qty}</td>}
                            {view === 'cost_production' && <td className="border-b border-slate-200 px-3 py-1.5 text-right font-mono text-emerald-700">{o.produced_cost?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SalaryReport({ data }) {
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Salary Report - Week {data.week_number}, {data.year}</h3>
            <table className="w-full text-xs border border-slate-200">
                <thead><tr className="bg-slate-50">
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left">Operator</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right">Qty</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right">Earnings</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right">Advance</th>
                    <th className="border-b border-slate-200 px-2 py-1.5 text-right">Net</th>
                </tr></thead>
                <tbody>
                    {data.operators?.map(o => (
                        <tr key={o.operator_id}><td className="border-r border-b border-slate-200 px-2 py-1">{o.operator_name} ({o.operator_code})</td>
                        <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono">{o.total_quantity}</td>
                        <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono">{o.total_earnings?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                        <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono text-amber-700">{o.advance_deducted?`-${o.advance_deducted?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}`:'-'}</td>
                        <td className="border-b border-slate-200 px-2 py-1 text-right font-mono font-bold">{o.net_salary?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td></tr>
                    ))}
                    <tr className="bg-slate-50 font-bold"><td className="border-r border-b px-2 py-1">TOTAL</td><td className="border-r border-b px-2 py-1"></td>
                    <td className="border-r border-b px-2 py-1 text-right font-mono">{data.grand_total?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                    <td className="border-r border-b px-2 py-1 text-right font-mono text-red-600">{data.total_advances?`-${data.total_advances?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}`:''}</td>
                    <td className="border-b px-2 py-1 text-right font-mono">{data.net_total?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td></tr>
                </tbody>
            </table>
        </div>
    );
}

function OperatorDetailReport({ data }) {
    const sizes = data.sizes || [];
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Operator Detail - {data.operator?.name} ({data.operator?.operator_code})</h3>
            <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-50 rounded p-2">Qty: <b className="font-mono">{data.total_qty}</b></div>
                <div className="bg-slate-50 rounded p-2">Earnings: <b className="font-mono text-emerald-700">{data.total_earnings?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</b></div>
                <div className="bg-slate-50 rounded p-2">Advance: <b className="font-mono text-red-600">{data.advance_balance?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</b></div>
                <div className="bg-slate-50 rounded p-2">Net: <b className="font-mono">{data.net_salary?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</b></div>
            </div>
            {data.operations?.length > 0 && sizes.length > 0 && (
                <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Operation x Size Matrix</p>
                    <div className="overflow-x-auto border border-slate-200 rounded">
                        <table className="w-full text-xs">
                            <thead><tr className="bg-slate-50">
                                <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold">Operation</th>
                                {sizes.map(s => <th key={s} className="border-r border-b border-slate-200 px-2 py-1.5 text-center font-semibold min-w-[50px]">{s}</th>)}
                                <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Total</th>
                                <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Rate</th>
                                <th className="border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Earnings</th>
                            </tr></thead>
                            <tbody>
                                {data.operations.map(o => (
                                    <tr key={o.operation}>
                                        <td className="border-r border-b border-slate-200 px-2 py-1 font-medium">{o.operation}</td>
                                        {sizes.map(s => <td key={s} className="border-r border-b border-slate-200 px-2 py-1 text-center font-mono">{o.sizes?.[s] || 0}</td>)}
                                        <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono font-semibold">{o.total_qty}</td>
                                        <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono">{o.rate}</td>
                                        <td className="border-b border-slate-200 px-2 py-1 text-right font-mono font-semibold text-emerald-700">{o.total_earnings?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function AdvanceReport({ data }) {
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-800 font-outfit">Advance Report</h3>
            <table className="w-full text-xs border border-slate-200">
                <thead><tr className="bg-slate-50">
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold">Voucher #</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold">Operator</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-left font-semibold">Date</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Advance</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Adjusted</th>
                    <th className="border-r border-b border-slate-200 px-2 py-1.5 text-right font-semibold">Balance</th>
                    <th className="border-b border-slate-200 px-2 py-1.5 text-left font-semibold">Status</th>
                </tr></thead>
                <tbody>{data.advances?.map((a,i) => (
                    <tr key={i}><td className="border-r border-b border-slate-200 px-2 py-1 font-mono text-blue-600">{a.voucher_number}</td>
                    <td className="border-r border-b border-slate-200 px-2 py-1">{a.operator_name} ({a.operator_code})</td>
                    <td className="border-r border-b border-slate-200 px-2 py-1 font-mono">{a.date}</td>
                    <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono">{a.amount?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                    <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono text-red-600">{a.total_adjusted?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                    <td className="border-r border-b border-slate-200 px-2 py-1 text-right font-mono font-semibold text-amber-700">{a.balance?.toLocaleString('en-IN',{style:'currency',currency:'INR'})}</td>
                    <td className="border-b border-slate-200 px-2 py-1 capitalize">{a.status?.replace('_',' ')}</td></tr>
                ))}</tbody>
            </table>
        </div>
    );
}
