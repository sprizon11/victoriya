import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Plus, Trash2, Save, ArrowLeft, Search } from 'lucide-react';

export default function LotFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEdit = !!id;

    const [form, setForm] = useState({ style_name: '', start_date: '', target_end_date: '' });
    const [sizeChartId, setSizeChartId] = useState('');
    const [selectedColors, setSelectedColors] = useState([]);
    const [colorSizeQty, setColorSizeQty] = useState({});
    const [lotOps, setLotOps] = useState([]);

    const [sizeCharts, setSizeCharts] = useState([]);
    const [colorsMaster, setColorsMaster] = useState([]);
    const [operations, setOperations] = useState([]);
    const [operators, setOperators] = useState([]);
    const [operatorSearch, setOperatorSearch] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([api.get('/size-charts'), api.get('/colors'), api.get('/operations'), api.get('/operators')])
            .then(([sc, cm, ops, opers]) => {
                setSizeCharts(sc.data);
                setColorsMaster(cm.data);
                setOperations(ops.data);
                setOperators(opers.data.filter(o => o.active));
            });
        if (isEdit) {
            api.get(`/lots/${id}`).then(r => {
                const lot = r.data;
                setForm({ style_name: lot.style_name, start_date: lot.start_date, target_end_date: lot.target_end_date });
                setSizeChartId(lot.size_chart_id || '');
                const colors = lot.colors?.map(c => c.name) || [];
                setSelectedColors(colors);
                const csq = {};
                lot.colors?.forEach(c => {
                    csq[c.name] = {};
                    c.sizes?.forEach(s => { csq[c.name][s.size] = String(s.planned_qty); });
                });
                setColorSizeQty(csq);
                setLotOps(lot.operations?.map(o => ({
                    operation_id: o.operation_id, rate: String(o.rate),
                    operator_ids: o.operators?.map(op => op.operator_id) || []
                })) || []);
            });
        }
    }, [id, isEdit]);

    const selectedChart = sizeCharts.find(sc => sc.id === sizeChartId);
    const sizes = selectedChart?.sizes || [];

    const toggleColor = (name) => {
        if (selectedColors.includes(name)) {
            setSelectedColors(selectedColors.filter(c => c !== name));
            const csq = { ...colorSizeQty };
            delete csq[name];
            setColorSizeQty(csq);
        } else {
            setSelectedColors([...selectedColors, name]);
            setColorSizeQty({ ...colorSizeQty, [name]: {} });
        }
    };

    const updateQty = (color, size, val) => {
        setColorSizeQty(prev => ({ ...prev, [color]: { ...prev[color], [size]: val } }));
    };

    const totalPlanned = useMemo(() => {
        let total = 0;
        Object.values(colorSizeQty).forEach(sizes => {
            Object.values(sizes).forEach(q => { total += parseInt(q) || 0; });
        });
        return total;
    }, [colorSizeQty]);

    const addOp = () => setLotOps([...lotOps, { operation_id: '', rate: '', operator_ids: [] }]);
    const removeOp = (i) => setLotOps(lotOps.filter((_, idx) => idx !== i));
    const updateOp = (i, field, val) => { const o = [...lotOps]; o[i] = { ...o[i], [field]: val }; setLotOps(o); };
    const toggleOperator = (oi, opId) => {
        const o = [...lotOps];
        const ids = o[oi].operator_ids;
        o[oi].operator_ids = ids.includes(opId) ? ids.filter(x => x !== opId) : [...ids, opId];
        setLotOps(o);
    };

    const getFilteredOperators = (oi) => {
        const search = (operatorSearch[oi] || '').toLowerCase();
        return operators.filter(o => o.name.toLowerCase().includes(search) || o.operator_code?.toLowerCase().includes(search));
    };

    const handleSave = async () => {
        if (!form.style_name || !form.start_date || !form.target_end_date) return toast.error('Fill basic details');
        if (!sizeChartId) return toast.error('Select a size chart');
        if (selectedColors.length === 0) return toast.error('Select at least one color');
        if (lotOps.length === 0 || lotOps.some(o => !o.operation_id || !o.rate)) return toast.error('Add operations with rates');

        setSaving(true);
        const payload = {
            ...form, size_chart_id: sizeChartId, color_names: selectedColors,
            color_size_quantities: colorSizeQty,
            operations: lotOps.map(o => ({ operation_id: o.operation_id, rate: parseFloat(o.rate), operator_ids: o.operator_ids }))
        };
        try {
            if (isEdit) { await api.put(`/lots/${id}`, payload); toast.success('Lot updated'); }
            else { await api.post('/lots', payload); toast.success('Lot created'); }
            navigate('/lots');
        } catch (err) { toast.error(err.response?.data?.detail || 'Error saving lot'); }
        finally { setSaving(false); }
    };

    return (
        <div className="space-y-4 max-w-5xl" data-testid="lot-form-page">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => navigate('/lots')} data-testid="back-to-lots"><ArrowLeft size={16} /></Button>
                <h1 className="text-2xl font-semibold text-slate-900 font-outfit">{isEdit ? 'Edit Lot' : 'Create New Lot'}</h1>
                <span className="text-sm font-mono text-slate-500 ml-auto">Total: {totalPlanned.toLocaleString()} pcs</span>
            </div>

            <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-4 bg-slate-100">
                    <TabsTrigger value="basic" data-testid="tab-basic">Basic</TabsTrigger>
                    <TabsTrigger value="planning" data-testid="tab-planning">Color & Size</TabsTrigger>
                    <TabsTrigger value="operations" data-testid="tab-operations">Operations</TabsTrigger>
                    <TabsTrigger value="assignment" data-testid="tab-assignment">Assignments</TabsTrigger>
                </TabsList>

                <TabsContent value="basic">
                    <Card className="border-slate-200">
                        <CardContent className="pt-6 space-y-4">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Style Name</Label>
                                <Input value={form.style_name} onChange={e => setForm({ ...form, style_name: e.target.value })} placeholder="e.g. Summer T-Shirt V2" className="mt-1" data-testid="style-name-input" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Start Date</Label>
                                    <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="mt-1" data-testid="start-date-input" />
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target End Date</Label>
                                    <Input type="date" value={form.target_end_date} onChange={e => setForm({ ...form, target_end_date: e.target.value })} className="mt-1" data-testid="end-date-input" />
                                </div>
                            </div>
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Size Chart</Label>
                                <Select value={sizeChartId} onValueChange={setSizeChartId}>
                                    <SelectTrigger className="mt-1 max-w-sm" data-testid="size-chart-select"><SelectValue placeholder="Select size chart" /></SelectTrigger>
                                    <SelectContent>
                                        {sizeCharts.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.name} ({sc.sizes?.join(', ')})</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                {selectedChart && <div className="flex gap-1 mt-2">{sizes.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}</div>}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="planning">
                    <Card className="border-slate-200">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base font-outfit">Select Colors & Enter Quantities</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 block">Colors (from master)</Label>
                                <div className="flex flex-wrap gap-2">
                                    {colorsMaster.map(c => (
                                        <Badge key={c.id} className={`cursor-pointer text-xs px-3 py-1 ${selectedColors.includes(c.name) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                                            onClick={() => toggleColor(c.name)} data-testid={`color-toggle-${c.name}`}>{c.name}</Badge>
                                    ))}
                                    {colorsMaster.length === 0 && <p className="text-xs text-slate-400">No colors in master. Add them from Colors page.</p>}
                                </div>
                            </div>
                            {!sizeChartId && <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">Select a size chart in the Basic tab first</p>}
                            {selectedColors.length > 0 && sizes.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border border-slate-200">
                                        <thead>
                                            <tr className="bg-slate-50">
                                                <th className="border-r border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Color</th>
                                                {sizes.map(s => <th key={s} className="border-r border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500 min-w-[70px]">{s}</th>)}
                                                <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedColors.map(color => {
                                                const rowTotal = sizes.reduce((s, sz) => s + (parseInt(colorSizeQty[color]?.[sz]) || 0), 0);
                                                return (
                                                    <tr key={color} className="hover:bg-slate-50/50">
                                                        <td className="border-r border-b border-slate-200 px-3 py-1.5 font-medium text-slate-800">{color}</td>
                                                        {sizes.map(sz => (
                                                            <td key={sz} className="border-r border-b border-slate-200 p-0">
                                                                <input type="number" min="0" className="excel-input w-full text-center"
                                                                    value={colorSizeQty[color]?.[sz] || ''} onChange={e => updateQty(color, sz, e.target.value)}
                                                                    data-testid={`qty-${color}-${sz}`} />
                                                            </td>
                                                        ))}
                                                        <td className="border-b border-slate-200 px-3 py-1.5 text-center font-mono font-semibold text-slate-700">{rowTotal}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="operations">
                    <Card className="border-slate-200">
                        <CardHeader className="pb-3"><CardTitle className="text-base font-outfit">Process & Rate Setup</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            {lotOps.map((op, oi) => (
                                <div key={op.operation_id || `op-${oi}`} className="flex items-center gap-3 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                                    <Select value={op.operation_id} onValueChange={v => updateOp(oi, 'operation_id', v)}>
                                        <SelectTrigger className="flex-1 bg-white" data-testid={`op-select-${oi}`}><SelectValue placeholder="Select operation" /></SelectTrigger>
                                        <SelectContent>{operations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs text-slate-500">Rate:</span>
                                        <Input type="number" value={op.rate} onChange={e => updateOp(oi, 'rate', e.target.value)} placeholder="0.00" className="w-24 bg-white font-mono" data-testid={`op-rate-${oi}`} min="0" step="0.01" />
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => removeOp(oi)} className="text-red-500"><Trash2 size={14} /></Button>
                                </div>
                            ))}
                            <Button variant="outline" onClick={addOp} className="gap-1.5" data-testid="add-operation-button"><Plus size={14} /> Add Operation</Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="assignment">
                    <Card className="border-slate-200">
                        <CardHeader className="pb-3"><CardTitle className="text-base font-outfit">Operator Assignment</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {lotOps.length === 0 && <p className="text-sm text-slate-400">Add operations first</p>}
                            {lotOps.map((op, oi) => {
                                const opName = operations.find(o => o.id === op.operation_id)?.name || 'Select operation';
                                const filtered = getFilteredOperators(oi);
                                return (
                                    <div key={op.operation_id || `assign-${oi}`} className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                                        <div className="flex items-center justify-between mb-2">
                                            <p className="text-sm font-medium text-slate-800">{opName} <span className="text-xs text-slate-500 font-mono ml-1">@ {op.rate}/pc</span></p>
                                            <Badge variant="secondary" className="text-[10px]">{op.operator_ids.length} assigned</Badge>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
                                            {op.operator_ids.map(id => {
                                                const o = operators.find(x => x.id === id);
                                                return o ? <Badge key={id} className="bg-blue-50 text-blue-700 text-[10px] gap-0.5 cursor-pointer hover:bg-blue-100" onClick={() => toggleOperator(oi, id)}>
                                                    {o.name} ({o.operator_code}) <span className="ml-0.5">x</span>
                                                </Badge> : null;
                                            })}
                                        </div>
                                        <div className="relative mb-2">
                                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <Input placeholder="Search operators..." value={operatorSearch[oi] || ''} onChange={e => setOperatorSearch({ ...operatorSearch, [oi]: e.target.value })}
                                                className="pl-8 h-8 text-xs" data-testid={`op-search-${oi}`} />
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
                                            {filtered.map(operator => (
                                                <label key={operator.id} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer hover:bg-white p-1 rounded" data-testid={`assign-${oi}-${operator.id}`}>
                                                    <Checkbox checked={op.operator_ids.includes(operator.id)} onCheckedChange={() => toggleOperator(oi, operator.id)} className="h-3.5 w-3.5" />
                                                    <span className="truncate">{operator.name} <span className="text-slate-400">({operator.operator_code})</span></span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => navigate('/lots')} data-testid="cancel-lot-button">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} data-testid="save-lot-button">
                    <Save size={15} /> {saving ? 'Saving...' : 'Save Lot'}
                </Button>
            </div>
        </div>
    );
}
