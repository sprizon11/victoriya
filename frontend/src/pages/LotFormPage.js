import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
import { Plus, Trash2, Save, ArrowLeft, Search, UsersRound } from 'lucide-react';

// A stable id per operation row. The row used to be keyed on the chosen
// operation id, so picking an operation changed the key, React rebuilt the row,
// and the cursor was thrown out of the field mid-edit.
const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `r${Date.now()}${Math.random()}`);

const selectCls = 'h-9 rounded-md border border-input bg-white px-2 text-sm';

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
    const [operatorGroups, setOperatorGroups] = useState([]);
    const [operatorSearch, setOperatorSearch] = useState({});
    const [groupFilter, setGroupFilter] = useState({});          // per operation row: all | none | group id
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(!isEdit);
    const initialRef = useRef(null);
    const cellRefs = useRef({});

    useEffect(() => {
        Promise.all([api.get('/size-charts'), api.get('/colors'), api.get('/operations'), api.get('/operators'), api.get('/operator-groups')])
            .then(([sc, cm, ops, opers, og]) => {
                setSizeCharts(sc.data);
                setColorsMaster(cm.data);
                setOperations(ops.data);
                setOperators(opers.data.filter(o => o.active));
                setOperatorGroups(og.data);
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
                    uid: uid(), operation_id: o.operation_id, rate: String(o.rate),
                    operator_ids: o.operators?.map(op => op.operator_id) || []
                })) || []);
                setLoaded(true);
            });
        }
    }, [id, isEdit]);

    // ---- unsaved-changes guard: a long form must not vanish on a stray click
    const snapshot = useMemo(() => JSON.stringify({ form, sizeChartId, selectedColors, colorSizeQty,
        lotOps: lotOps.map(o => ({ operation_id: o.operation_id, rate: o.rate, operator_ids: o.operator_ids })) }),[form, sizeChartId, selectedColors, colorSizeQty, lotOps]);
    useEffect(() => { if (loaded && initialRef.current === null) initialRef.current = snapshot; }, [loaded, snapshot]);
    const dirty = loaded && initialRef.current !== null && initialRef.current !== snapshot;
    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    const leave = () => {
        if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
        navigate('/lots');
    };

    const selectedChart = sizeCharts.find(sc => sc.id === sizeChartId);
    const sizes = useMemo(() => selectedChart?.sizes || [], [selectedChart]);

    // functional updates: two quick toggles must both land (a closure over the old
    // list made the second click overwrite the first)
    const toggleColor = (name) => {
        setSelectedColors(prev => (prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]));
        setColorSizeQty(prev => {
            const next = { ...prev };
            if (name in next) delete next[name]; else next[name] = {};
            return next;
        });
    };

    // Quantities are kept as the text the user typed (digits only); they are
    // parsed on save. Re-formatting while typing is what moves the caret.
    const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 7);
    const updateQty = (color, size, val) => {
        setColorSizeQty(prev => ({ ...prev, [color]: { ...prev[color], [size]: digits(val) } }));
    };

    const rowTotal = (color) => sizes.reduce((s, sz) => s + (parseInt(colorSizeQty[color]?.[sz], 10) || 0), 0);
    const colTotal = (sz) => selectedColors.reduce((s, c) => s + (parseInt(colorSizeQty[c]?.[sz], 10) || 0), 0);
    const totalPlanned = useMemo(() => selectedColors.reduce((t, c) =>
        t + sizes.reduce((s, sz) => s + (parseInt(colorSizeQty[c]?.[sz], 10) || 0), 0), 0), [selectedColors, sizes, colorSizeQty]);

    // ---- spreadsheet behaviour for the quantity grid
    const focusCell = useCallback((r, c) => {
        const el = cellRefs.current[`${r}:${c}`];
        if (el) { el.focus(); el.select(); }
    }, []);
    const onCellKeyDown = (e, r, c) => {
        const { selectionStart: a, selectionEnd: b, value } = e.target;
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
        else if (e.key === 'ArrowRight' && a === value.length && b === value.length) { e.preventDefault(); focusCell(r, c + 1); }
        else if (e.key === 'ArrowLeft' && a === 0 && b === 0) { e.preventDefault(); focusCell(r, c - 1); }
    };
    const onCellPaste = (e, r, c) => {
        const text = e.clipboardData.getData('text');
        if (!/[\t\n]/.test(text)) return;                 // single value: let the browser paste normally
        e.preventDefault();
        const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
        setColorSizeQty(prev => {
            const next = { ...prev };
            rows.forEach((cells, dr) => {
                const color = selectedColors[r + dr];
                if (!color) return;
                next[color] = { ...(next[color] || {}) };
                cells.forEach((cell, dc) => {
                    const size = sizes[c + dc];
                    if (size) next[color][size] = digits(cell);
                });
            });
            return next;
        });
        toast.success('Pasted into the grid');
    };

    // ---- operations
    const addOp = () => setLotOps([...lotOps, { uid: uid(), operation_id: '', rate: '', operator_ids: [] }]);
    const removeOp = (key) => setLotOps(lotOps.filter(o => o.uid !== key));
    const updateOp = (key, field, val) => setLotOps(lotOps.map(o => (o.uid === key ? { ...o, [field]: val } : o)));
    const setOperatorIds = (key, ids) => setLotOps(lotOps.map(o => (o.uid === key ? { ...o, operator_ids: ids } : o)));
    const toggleOperator = (key, opId) => {
        const op = lotOps.find(o => o.uid === key);
        setOperatorIds(key, op.operator_ids.includes(opId) ? op.operator_ids.filter(x => x !== opId) : [...op.operator_ids, opId]);
    };
    const addGroup = (key, gid) => {
        const op = lotOps.find(o => o.uid === key);
        const members = operators.filter(o => o.group_id === gid).map(o => o.id);
        setOperatorIds(key, Array.from(new Set([...op.operator_ids, ...members])));
        toast.success(`${members.length} operator${members.length === 1 ? '' : 's'} added`);
    };

    // operations shown under their group, in the group's own order
    const operationOptions = useMemo(() => {
        const byGroup = {};
        operations.filter(o => o.active !== false).forEach(o => { (byGroup[o.group_name || ''] ||= []).push(o); });
        return Object.entries(byGroup).sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    }, [operations]);

    const getFilteredOperators = (key) => {
        const search = (operatorSearch[key] || '').toLowerCase();
        const gf = groupFilter[key] || 'all';
        return operators.filter(o =>
            (o.name.toLowerCase().includes(search) || o.operator_code?.toLowerCase().includes(search)) &&
            (gf === 'all' || (gf === 'none' ? !o.group_id : o.group_id === gf)));
    };

    const handleSave = async () => {
        if (!form.style_name || !form.start_date || !form.target_end_date) return toast.error('Fill basic details');
        if (!sizeChartId) return toast.error('Select a size chart');
        if (selectedColors.length === 0) return toast.error('Select at least one color');
        if (lotOps.length === 0 || lotOps.some(o => !o.operation_id || o.rate === '')) return toast.error('Add operations with rates');

        setSaving(true);
        const payload = {
            ...form, size_chart_id: sizeChartId, color_names: selectedColors,
            color_size_quantities: colorSizeQty,
            operations: lotOps.map(o => ({ operation_id: o.operation_id, rate: parseFloat(o.rate), operator_ids: o.operator_ids }))
        };
        try {
            if (isEdit) { await api.put(`/lots/${id}`, payload); toast.success('Lot updated'); }
            else { await api.post('/lots', payload); toast.success('Lot created'); }
            initialRef.current = snapshot;          // saved: nothing left to warn about
            navigate('/lots');
        } catch (err) {
            // stay on the form with everything the user typed; say exactly why it was refused
            toast.error(err.response?.data?.detail || 'Error saving lot', { duration: 8000 });
        } finally { setSaving(false); }
    };

    return (
        <div className="space-y-4 max-w-5xl" data-testid="lot-form-page">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={leave} aria-label="Back to lots" data-testid="back-to-lots"><ArrowLeft size={16} /></Button>
                <h1 className="text-2xl font-semibold text-slate-900 font-outfit">{isEdit ? 'Edit Lot' : 'Create New Lot'}</h1>
                {dirty && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200" data-testid="unsaved-chip">Unsaved changes</span>}
                <span className="text-sm font-mono text-slate-500 ml-auto" data-testid="lot-total">Total: {totalPlanned.toLocaleString('en-IN')} pcs</span>
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                    {colorsMaster.map(c => {
                                        const on = selectedColors.includes(c.name);
                                        return (
                                            <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleColor(c.name)}
                                                data-testid={`color-toggle-${c.name}`}
                                                className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                                                {c.name}
                                            </button>
                                        );
                                    })}
                                    {colorsMaster.length === 0 && <p className="text-xs text-slate-400">No colors in master. Add them from Colors page.</p>}
                                </div>
                            </div>
                            {!sizeChartId && <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">Select a size chart in the Basic tab first</p>}
                            {selectedColors.length > 0 && sizes.length > 0 && (
                                <>
                                    <p className="text-[11.5px] text-slate-400">
                                        Tip: Enter / arrow keys move between cells. You can paste a block of numbers copied from Excel.
                                    </p>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm border border-slate-200" data-testid="qty-grid">
                                            <thead>
                                                <tr className="bg-slate-50">
                                                    <th className="sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Color</th>
                                                    {sizes.map(s => <th key={s} className="border-r border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500 min-w-[70px]">{s}</th>)}
                                                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedColors.map((color, r) => (
                                                    <tr key={color} className="hover:bg-slate-50/50">
                                                        <td className="sticky left-0 z-10 bg-white border-r border-b border-slate-200 px-3 py-1.5 font-medium text-slate-800">{color}</td>
                                                        {sizes.map((sz, c) => (
                                                            <td key={sz} className="border-r border-b border-slate-200 p-0">
                                                                <input type="text" inputMode="numeric" autoComplete="off" className="excel-input w-full text-center"
                                                                    aria-label={`${color} size ${sz} quantity`}
                                                                    ref={el => { cellRefs.current[`${r}:${c}`] = el; }}
                                                                    value={colorSizeQty[color]?.[sz] ?? ''}
                                                                    onChange={e => updateQty(color, sz, e.target.value)}
                                                                    onFocus={e => e.target.select()}
                                                                    onKeyDown={e => onCellKeyDown(e, r, c)}
                                                                    onPaste={e => onCellPaste(e, r, c)}
                                                                    data-testid={`qty-${color}-${sz}`} />
                                                            </td>
                                                        ))}
                                                        <td className="border-b border-slate-200 px-3 py-1.5 text-center font-mono font-semibold text-slate-700">{rowTotal(color)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="bg-slate-50 font-mono font-semibold text-slate-700">
                                                    <td className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-3 py-1.5 font-sans text-xs uppercase text-slate-500">Total</td>
                                                    {sizes.map(sz => <td key={sz} className="border-r border-slate-200 px-3 py-1.5 text-center">{colTotal(sz)}</td>)}
                                                    <td className="px-3 py-1.5 text-center text-brand" data-testid="grid-grand-total">{totalPlanned}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="operations">
                    <Card className="border-slate-200">
                        <CardHeader className="pb-3"><CardTitle className="text-base font-outfit">Process & Rate Setup</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            {lotOps.map((op, oi) => (
                                <div key={op.uid} className="flex flex-wrap items-center gap-3 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                                    <select className={`${selectCls} min-w-[200px] flex-1`} value={op.operation_id}
                                        onChange={e => updateOp(op.uid, 'operation_id', e.target.value)}
                                        aria-label={`Operation ${oi + 1}`} data-testid={`op-select-${oi}`}>
                                        <option value="">Select operation</option>
                                        {operationOptions.map(([group, list]) => (
                                            <optgroup key={group || 'none'} label={group || 'No group'}>
                                                {list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs text-slate-500">Rate:</span>
                                        <Input type="text" inputMode="decimal" value={op.rate}
                                            onChange={e => updateOp(op.uid, 'rate', e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                                            placeholder="0.00" className="w-24 bg-white font-mono" data-testid={`op-rate-${oi}`} aria-label={`Rate for operation ${oi + 1}`} />
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => removeOp(op.uid)} className="text-red-500" aria-label={`Remove operation ${oi + 1}`}><Trash2 size={14} /></Button>
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
                                const filtered = getFilteredOperators(op.uid);
                                const gf = groupFilter[op.uid] || 'all';
                                return (
                                    <div key={op.uid} className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
                                        <div className="flex items-center justify-between mb-2">
                                            <p className="text-sm font-medium text-slate-800">{opName} <span className="text-xs text-slate-500 font-mono ml-1">@ {op.rate || 0}/pc</span></p>
                                            <Badge variant="secondary" className="text-[10px]">{op.operator_ids.length} assigned</Badge>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
                                            {op.operator_ids.map(oid => {
                                                const o = operators.find(x => x.id === oid);
                                                return o ? (
                                                    <button type="button" key={oid} onClick={() => toggleOperator(op.uid, oid)}
                                                        aria-label={`Remove ${o.name}`}
                                                        className="cursor-pointer rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100">
                                                        {o.name} ({o.operator_code}) <span className="ml-0.5">x</span>
                                                    </button>
                                                ) : null;
                                            })}
                                        </div>
                                        {operatorGroups.length > 0 && (
                                            <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid={`group-chips-${oi}`}>
                                                {[['all', 'All'], ...operatorGroups.map(g => [g.id, `${g.name} (${g.member_count})`]), ['none', 'No group']].map(([k, label]) => (
                                                    <button type="button" key={k} onClick={() => setGroupFilter({ ...groupFilter, [op.uid]: k })}
                                                        aria-pressed={gf === k}
                                                        className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium ${gf === k ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100'}`}>
                                                        {label}
                                                    </button>
                                                ))}
                                                {gf !== 'all' && gf !== 'none' && (
                                                    <Button type="button" size="sm" variant="outline" className="ml-1 h-6 gap-1 px-2 text-[11px]"
                                                        onClick={() => addGroup(op.uid, gf)} data-testid={`add-group-${oi}`}>
                                                        <UsersRound size={12} /> Add whole group
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                        <div className="relative mb-2">
                                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <Input placeholder="Search operators..." value={operatorSearch[op.uid] || ''} onChange={e => setOperatorSearch({ ...operatorSearch, [op.uid]: e.target.value })}
                                                className="pl-8 h-8 text-xs" data-testid={`op-search-${oi}`} />
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-40 overflow-y-auto">
                                            {filtered.map(operator => (
                                                <label key={operator.id} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer hover:bg-white p-1 rounded" data-testid={`assign-${oi}-${operator.id}`}>
                                                    <Checkbox checked={op.operator_ids.includes(operator.id)} onCheckedChange={() => toggleOperator(op.uid, operator.id)} className="h-3.5 w-3.5" />
                                                    <span className="truncate">{operator.name} <span className="text-slate-400">({operator.operator_code})</span></span>
                                                </label>
                                            ))}
                                            {filtered.length === 0 && <p className="col-span-full py-2 text-xs text-slate-400">No operators match.</p>}
                                        </div>
                                    </div>
                                );
                            })}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={leave} data-testid="cancel-lot-button">Cancel</Button>
                <Button onClick={handleSave} disabled={saving} data-testid="save-lot-button">
                    <Save size={15} /> {saving ? 'Saving...' : 'Save Lot'}
                </Button>
            </div>
        </div>
    );
}
