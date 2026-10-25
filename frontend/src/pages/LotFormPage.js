import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../lib/api';
import { plannedFromOrder } from '../lib/utils';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { Plus, Trash2, Save, ArrowLeft, Search, UsersRound, Lock, FileText } from 'lucide-react';

// A stable id per operation row. The row used to be keyed on the chosen
// operation id, so picking an operation changed the key, React rebuilt the row,
// and the cursor was thrown out of the field mid-edit.
const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `r${Date.now()}${Math.random()}`);

const selectCls = 'h-9 rounded-md border border-input bg-white px-2 text-sm';
const rateText = (v) => String(v ?? '').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 7);
const mapToStrings = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, String(v)]));
const cleanRates = (obj, sizes) => Object.fromEntries(
    sizes.filter(sz => String(obj?.[sz] ?? '').trim() !== '').map(sz => [sz, parseFloat(obj[sz])]));

const newReq = () => ({ uid: uid(), item_id: '', basis: 'per_piece', qty: '' });
const newOp = () => ({ uid: uid(), operation_id: '', rate: '', useSizes: false, sizeRates: {}, extras: {}, operator_ids: [] });

/** One rate (flat + optional per-size overrides) for one rate type. */
function RateEditor({ label, rate, onRate, useSizes, onUseSizes, sizeRates, onSizeRate, sizes, testid }) {
    return (
        <div className="rounded-md border border-slate-200 bg-white p-2.5" data-testid={`${testid}-editor`}>
            <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-xs font-semibold text-slate-600">{label}</span>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">Rate</span>
                    <Input type="text" inputMode="decimal" value={rate} onChange={e => onRate(rateText(e.target.value))}
                        placeholder="0.00" className="w-24 font-mono" data-testid={`${testid}-rate`} aria-label={`${label} rate`} />
                </div>
                {sizes.length > 0 && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                        <Checkbox checked={useSizes} onCheckedChange={v => onUseSizes(!!v)} data-testid={`${testid}-sizes-toggle`} />
                        Different rate per size
                    </label>
                )}
            </div>
            {useSizes && (
                <div className="mt-2 flex flex-wrap gap-2" data-testid={`${testid}-sizes`}>
                    {sizes.map(sz => (
                        <label key={sz} className="flex flex-col items-center gap-0.5 text-[10px] font-semibold uppercase text-slate-500">
                            {sz}
                            <Input type="text" inputMode="decimal" value={sizeRates[sz] ?? ''} placeholder={rate || '0'}
                                onChange={e => onSizeRate(sz, rateText(e.target.value))}
                                className="h-8 w-16 text-center font-mono" data-testid={`${testid}-size-${sz}`} aria-label={`${label} rate for size ${sz}`} />
                        </label>
                    ))}
                    <p className="basis-full text-[10.5px] text-slate-400">Leave a size blank to use the flat rate.</p>
                </div>
            )}
        </div>
    );
}

export default function LotFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEdit = !!id;

    const [form, setForm] = useState({ style_name: '', start_date: '', target_end_date: '' });
    const [sizeChartId, setSizeChartId] = useState('');
    const [allowance, setAllowance] = useState('');
    const [orderRate, setOrderRate] = useState('');
    const [selectedColors, setSelectedColors] = useState([]);
    const [colorSizeQty, setColorSizeQty] = useState({});
    const [lotOps, setLotOps] = useState([]);
    const [qc, setQc] = useState({ over_tolerance_pct: '', warn_at_pct: '90', locked: {} });
    const [reqs, setReqs] = useState([]);
    const [postPct, setPostPct] = useState('');
    const [stockItems, setStockItems] = useState([]);

    const [sizeCharts, setSizeCharts] = useState([]);
    const [colorsMaster, setColorsMaster] = useState([]);
    const [operations, setOperations] = useState([]);
    const [operators, setOperators] = useState([]);
    const [operatorGroups, setOperatorGroups] = useState([]);
    const [rateTypes, setRateTypes] = useState([]);
    const [operatorSearch, setOperatorSearch] = useState({});
    const [groupFilter, setGroupFilter] = useState({});          // per operation row: all | none | group id
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(!isEdit);
    const initialRef = useRef(null);
    const cellRefs = useRef({});

    const defaultType = rateTypes.find(t => t.is_default);
    const otherTypes = rateTypes.filter(t => !t.is_default && t.active !== false);

    useEffect(() => {
        Promise.all([api.get('/size-charts'), api.get('/colors'), api.get('/operations'), api.get('/operators'),
            api.get('/operator-groups'), api.get('/rate-types'), api.get('/stock/items')])
            .then(([sc, cm, ops, opers, og, rt, si]) => {
                setStockItems(si.data.filter(i => i.active !== false));
                setSizeCharts(sc.data);
                setColorsMaster(cm.data);
                setOperations(ops.data);
                setOperators(opers.data.filter(o => o.active));
                setOperatorGroups(og.data);
                setRateTypes(rt.data);
            });
        if (isEdit) {
            api.get(`/lots/${id}`).then(r => {
                const lot = r.data;
                setForm({ style_name: lot.style_name, start_date: lot.start_date, target_end_date: lot.target_end_date });
                setSizeChartId(lot.size_chart_id || '');
                setAllowance(lot.allowance_pct ? String(lot.allowance_pct) : '');
                setPostPct(lot.post_pct ? String(lot.post_pct) : '');
                setOrderRate(lot.order_rate ? String(lot.order_rate) : '');
                setReqs((lot.requirements || []).map(r => ({ uid: uid(), item_id: r.item_id, basis: r.basis,
                    qty: String(r.basis === 'per_piece' ? r.qty_per_piece : r.total_qty) })));
                setSelectedColors(lot.colors?.map(c => c.name) || []);
                const csq = {};
                lot.colors?.forEach(c => {
                    csq[c.name] = {};
                    c.sizes?.forEach(s => { csq[c.name][s.size] = String(s.order_qty ?? s.planned_qty); });   // the ORDER, not the plan
                });
                setColorSizeQty(csq);
                const q = lot.quantity_control || {};
                setQc({ over_tolerance_pct: q.over_tolerance_pct ? String(q.over_tolerance_pct) : '', warn_at_pct: String(q.warn_at_pct ?? 90),
                    locked: q.locked || {} });
                setLotOps(lot.operations?.map(o => {
                    const rows = o.rates || [];
                    const regular = rows[0] || { rate: o.rate, size_rates: o.size_rates || {} };
                    const extras = {};
                    rows.slice(1).forEach(r => {
                        extras[r.rate_type_id] = { rate: String(r.rate), useSizes: Object.keys(r.size_rates || {}).length > 0,
                            sizeRates: mapToStrings(r.size_rates) };
                    });
                    return { uid: uid(), operation_id: o.operation_id, rate: String(regular.rate ?? o.rate),
                        useSizes: Object.keys(regular.size_rates || {}).length > 0, sizeRates: mapToStrings(regular.size_rates),
                        extras, operator_ids: o.operators?.map(op => op.operator_id) || [] };
                }) || []);
                setLoaded(true);
            });
        }
    }, [id, isEdit]);

    // ---- unsaved-changes guard: a long form must not vanish on a stray click
    const snapshot = useMemo(() => JSON.stringify({ form, sizeChartId, allowance, orderRate, selectedColors, colorSizeQty, qc, postPct,
        reqs: reqs.map(r => ({ item_id: r.item_id, basis: r.basis, qty: r.qty })),
        lotOps: lotOps.map(o => ({ operation_id: o.operation_id, rate: o.rate, useSizes: o.useSizes, sizeRates: o.sizeRates,
            extras: o.extras, operator_ids: o.operator_ids })) }), [form, sizeChartId, allowance, orderRate, selectedColors, colorSizeQty, qc, postPct, reqs, lotOps]);
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
    const updateQty = (color, size, val) => {
        setColorSizeQty(prev => ({ ...prev, [color]: { ...prev[color], [size]: digits(val) } }));
    };

    const orderOf = (c, sz) => parseInt(colorSizeQty[c]?.[sz], 10) || 0;
    const planOf = (c, sz) => plannedFromOrder(orderOf(c, sz), allowance);
    const rowOrder = (c) => sizes.reduce((s, sz) => s + orderOf(c, sz), 0);
    const rowPlan = (c) => sizes.reduce((s, sz) => s + planOf(c, sz), 0);
    const colOrder = (sz) => selectedColors.reduce((s, c) => s + orderOf(c, sz), 0);
    const colPlan = (sz) => selectedColors.reduce((s, c) => s + planOf(c, sz), 0);
    const totalOrder = useMemo(() => selectedColors.reduce((t, c) => t + sizes.reduce((s, sz) => s + orderOf(c, sz), 0), 0),
        [selectedColors, sizes, colorSizeQty]);
    // the overall total is the sum of the ROUNDED cells, never the rounded sum
    const totalPlanned = useMemo(() => selectedColors.reduce((t, c) => t + sizes.reduce((s, sz) => s + planOf(c, sz), 0), 0),
        [selectedColors, sizes, colorSizeQty, allowance]);
    const hasAllowance = (parseFloat(allowance) || 0) > 0;

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
    const addOp = () => setLotOps([...lotOps, newOp()]);
    const removeOp = (key) => setLotOps(lotOps.filter(o => o.uid !== key));
    const patchOp = (key, patch) => setLotOps(lotOps.map(o => (o.uid === key ? { ...o, ...patch } : o)));
    const updateOp = (key, field, val) => patchOp(key, { [field]: val });
    const setSizeRate = (key, sz, v) => setLotOps(lotOps.map(o => (o.uid === key ? { ...o, sizeRates: { ...o.sizeRates, [sz]: v } } : o)));
    const patchExtra = (key, typeId, patch) => setLotOps(lotOps.map(o => (o.uid === key
        ? { ...o, extras: { ...o.extras, [typeId]: { rate: '', useSizes: false, sizeRates: {}, ...o.extras[typeId], ...patch } } } : o)));
    const toggleExtra = (key, typeId) => setLotOps(lotOps.map(o => {
        if (o.uid !== key) return o;
        const extras = { ...o.extras };
        if (typeId in extras) delete extras[typeId]; else extras[typeId] = { rate: '', useSizes: false, sizeRates: {} };
        return { ...o, extras };
    }));
    const setOperatorIds = (key, ids) => patchOp(key, { operator_ids: ids });
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

    // ---- materials: the same rule as the server (backend/purchasing.py gross_requirement), as a live preview
    const COUNTED = ['pcs', 'cone', 'box', 'roll'];
    const grossFor = (r) => {
        const it = stockItems.find(i => i.id === r.item_id);
        const q = parseFloat(r.qty) || 0;
        const base = r.basis === 'per_piece' ? q * totalPlanned : q;
        const gross = base * (1 + (parseFloat(postPct) || 0) / 100);
        const step = it && COUNTED.includes(it.uom) ? 1 : 0.001;
        return Math.ceil(gross / step - 1e-9) * step;
    };
    const patchReq = (key, patch) => setReqs(reqs.map(r => (r.uid === key ? { ...r, ...patch } : r)));
    const regenerate = async () => {
        try {
            const r = await api.post(`/lots/${id}/generate-po`);
            toast.success(r.data.message, { duration: 6000 });
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not draft orders', { duration: 8000 }); }
    };

    const toggleLock = (color, sz) => setQc(prev => {
        const locked = { ...prev.locked };
        const key = `${color}|${sz}`;
        if (locked[key]) delete locked[key]; else locked[key] = true;
        return { ...prev, locked };
    });

    const handleSave = async () => {
        if (!form.style_name || !form.start_date || !form.target_end_date) return toast.error('Fill basic details');
        if (!sizeChartId) return toast.error('Select a size chart');
        if (selectedColors.length === 0) return toast.error('Select at least one color');
        if (lotOps.length === 0 || lotOps.some(o => !o.operation_id || o.rate === '')) return toast.error('Add operations with rates');
        if (lotOps.some(o => Object.values(o.extras).some(x => x.rate === ''))) return toast.error('Fill in the rate for every extra rate type you switched on');
        if (reqs.some(r => r.item_id && !(parseFloat(r.qty) > 0))) return toast.error('Enter a quantity for every material you listed');

        setSaving(true);
        const payload = {
            ...form, size_chart_id: sizeChartId, color_names: selectedColors,
            color_size_quantities: colorSizeQty, allowance_pct: parseFloat(allowance) || 0,
            order_rate: orderRate === '' ? null : parseFloat(orderRate),
            post_pct: parseFloat(postPct) || 0,
            requirements: reqs.filter(r => r.item_id).map(r => ({ item_id: r.item_id, basis: r.basis,
                ...(r.basis === 'per_piece' ? { qty_per_piece: parseFloat(r.qty) } : { total_qty: parseFloat(r.qty) }) })),
            quantity_control: { over_tolerance_pct: parseFloat(qc.over_tolerance_pct) || 0,
                warn_at_pct: parseFloat(qc.warn_at_pct) || 90, locked: qc.locked },
            operations: lotOps.map(o => ({
                operation_id: o.operation_id, rate: parseFloat(o.rate), operator_ids: o.operator_ids,
                size_rates: o.useSizes ? cleanRates(o.sizeRates, sizes) : null,
                extra_rates: Object.entries(o.extras).map(([typeId, x]) => ({
                    rate_type_id: typeId, rate: parseFloat(x.rate), size_rates: x.useSizes ? cleanRates(x.sizeRates, sizes) : null })),
            })),
        };
        try {
            if (isEdit) { await api.put(`/lots/${id}`, payload); toast.success('Lot updated'); }
            else {
                const created = await api.post('/lots', payload);
                const n = created.data.draft_pos?.length || 0;
                toast.success(n ? `Lot created. ${n} draft purchase order${n === 1 ? '' : 's'} ready to review.` : 'Lot created', { duration: 7000 });
            }
            initialRef.current = snapshot;          // saved: nothing left to warn about
            navigate('/lots');
        } catch (err) {
            // stay on the form with everything the user typed; say exactly why it was refused
            const d = err.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : (d?.message || 'Error saving lot'), { duration: 8000 });
        } finally { setSaving(false); }
    };

    return (
        <div className="space-y-4 max-w-5xl" data-testid="lot-form-page">
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" onClick={leave} aria-label="Back to lots" data-testid="back-to-lots"><ArrowLeft size={16} /></Button>
                <h1 className="text-2xl font-semibold text-slate-900 font-outfit">{isEdit ? 'Edit Lot' : 'Create New Lot'}</h1>
                {dirty && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200" data-testid="unsaved-chip">Unsaved changes</span>}
                <span className="ml-auto text-sm font-mono text-slate-500" data-testid="lot-total">
                    {hasAllowance
                        ? <>Order {totalOrder.toLocaleString('en-IN')} + {(totalPlanned - totalOrder).toLocaleString('en-IN')} = <strong className="text-brand">{totalPlanned.toLocaleString('en-IN')} pcs</strong></>
                        : <>Total: {totalPlanned.toLocaleString('en-IN')} pcs</>}
                </span>
            </div>

            <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-5 bg-slate-100">
                    <TabsTrigger value="basic" data-testid="tab-basic">Basic</TabsTrigger>
                    <TabsTrigger value="planning" data-testid="tab-planning">Color & Size</TabsTrigger>
                    <TabsTrigger value="operations" data-testid="tab-operations">Operations</TabsTrigger>
                    <TabsTrigger value="assignment" data-testid="tab-assignment">Assignments</TabsTrigger>
                    <TabsTrigger value="materials" data-testid="tab-materials">Materials</TabsTrigger>
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
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Price per piece (optional)</Label>
                                <Input type="text" inputMode="decimal" value={orderRate} onChange={e => setOrderRate(rateText(e.target.value))}
                                    placeholder="what the buyer pays" className="mt-1 w-40 font-mono" data-testid="order-rate-input" aria-describedby="order-rate-help" />
                                <p id="order-rate-help" className="mt-1 text-[11px] text-slate-400">Only used to show profit in the costing report.</p>
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
                            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Allowance %</Label>
                                    <Input type="text" inputMode="decimal" value={allowance} onChange={e => setAllowance(rateText(e.target.value))}
                                        placeholder="0" className="mt-1 w-28 font-mono" data-testid="allowance-input" aria-describedby="allowance-help" />
                                </div>
                                <p id="allowance-help" className="max-w-md text-[11.5px] text-slate-500">
                                    Extra pieces added to what was ordered, rounded to the nearest whole piece per size
                                    (115.5 becomes 116; 115.49 stays 115). Type the <strong>ordered</strong> quantities below.
                                </p>
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
                                                    {sizes.map(s => <th key={s} className="border-r border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500 min-w-[78px]">{s}</th>)}
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
                                                                    aria-label={`${color} size ${sz} ordered quantity`}
                                                                    ref={el => { cellRefs.current[`${r}:${c}`] = el; }}
                                                                    value={colorSizeQty[color]?.[sz] ?? ''}
                                                                    onChange={e => updateQty(color, sz, e.target.value)}
                                                                    onFocus={e => e.target.select()}
                                                                    onKeyDown={e => onCellKeyDown(e, r, c)}
                                                                    onPaste={e => onCellPaste(e, r, c)}
                                                                    data-testid={`qty-${color}-${sz}`} />
                                                                {hasAllowance && orderOf(color, sz) > 0 && (
                                                                    <span className="block pb-0.5 text-center text-[10px] text-slate-400" data-testid={`plan-${color}-${sz}`}>
                                                                        plan {planOf(color, sz)}
                                                                    </span>
                                                                )}
                                                            </td>
                                                        ))}
                                                        <td className="border-b border-slate-200 px-3 py-1.5 text-center font-mono font-semibold text-slate-700">
                                                            {rowOrder(color)}{hasAllowance && <span className="block text-[10px] font-normal text-slate-400">plan {rowPlan(color)}</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="bg-slate-50 font-mono font-semibold text-slate-700">
                                                    <td className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-3 py-1.5 font-sans text-xs uppercase text-slate-500">Total</td>
                                                    {sizes.map(sz => (
                                                        <td key={sz} className="border-r border-slate-200 px-3 py-1.5 text-center">
                                                            {colOrder(sz)}{hasAllowance && <span className="block text-[10px] font-normal text-slate-400">plan {colPlan(sz)}</span>}
                                                        </td>
                                                    ))}
                                                    <td className="px-3 py-1.5 text-center text-brand" data-testid="grid-grand-total">
                                                        {hasAllowance ? totalPlanned : totalOrder}
                                                        {hasAllowance && <span className="block text-[10px] font-normal text-slate-400">order {totalOrder}</span>}
                                                    </td>
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
                                <div key={op.uid} className="space-y-2 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                                    <div className="flex flex-wrap items-center gap-3">
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
                                        <Button variant="ghost" size="sm" onClick={() => removeOp(op.uid)} className="text-red-500" aria-label={`Remove operation ${oi + 1}`}><Trash2 size={14} /></Button>
                                    </div>
                                    <RateEditor label={defaultType?.name || 'Regular'} testid={`op-${oi}`}
                                        rate={op.rate} onRate={v => updateOp(op.uid, 'rate', v)}
                                        useSizes={op.useSizes} onUseSizes={v => updateOp(op.uid, 'useSizes', v)}
                                        sizeRates={op.sizeRates} onSizeRate={(sz, v) => setSizeRate(op.uid, sz, v)} sizes={sizes} />
                                    {otherTypes.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-[11px] text-slate-500">Also pay at:</span>
                                                {otherTypes.map(t => (
                                                    <button key={t.id} type="button" aria-pressed={t.id in op.extras} onClick={() => toggleExtra(op.uid, t.id)}
                                                        data-testid={`op-${oi}-extra-${t.name}`}
                                                        className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset
                                                            ${t.id in op.extras ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'}`}>
                                                        {t.name}{!t.counts_toward_plan && ' (not in plan)'}
                                                    </button>
                                                ))}
                                            </div>
                                            {otherTypes.filter(t => t.id in op.extras).map(t => (
                                                <RateEditor key={t.id} label={t.name} testid={`op-${oi}-${t.name}`}
                                                    rate={op.extras[t.id].rate} onRate={v => patchExtra(op.uid, t.id, { rate: v })}
                                                    useSizes={op.extras[t.id].useSizes} onUseSizes={v => patchExtra(op.uid, t.id, { useSizes: v })}
                                                    sizeRates={op.extras[t.id].sizeRates}
                                                    onSizeRate={(sz, v) => patchExtra(op.uid, t.id, { sizeRates: { ...op.extras[t.id].sizeRates, [sz]: v } })} sizes={sizes} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            <Button variant="outline" onClick={addOp} className="gap-1.5" data-testid="add-operation-button"><Plus size={14} /> Add Operation</Button>
                        </CardContent>
                    </Card>

                    <Card className="mt-4 border-slate-200" data-testid="quantity-control-card">
                        <CardHeader className="pb-3"><CardTitle className="text-base font-outfit">Quantity control</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            <p className="text-xs text-slate-500">
                                By default nobody can enter more than the plan. You can allow a small extra, but only with an administrator's approval.
                            </p>
                            <div className="flex flex-wrap gap-4">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Over-production allowed with approval (%)</Label>
                                    <Input type="text" inputMode="decimal" value={qc.over_tolerance_pct} placeholder="0 = never"
                                        onChange={e => setQc({ ...qc, over_tolerance_pct: rateText(e.target.value) })}
                                        className="mt-1 w-32 font-mono" data-testid="qc-tolerance" />
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Warn when a size reaches (%)</Label>
                                    <Input type="text" inputMode="decimal" value={qc.warn_at_pct}
                                        onChange={e => setQc({ ...qc, warn_at_pct: rateText(e.target.value) })}
                                        className="mt-1 w-32 font-mono" data-testid="qc-warn" />
                                </div>
                            </div>
                            {isEdit && selectedColors.length > 0 && sizes.length > 0 && (
                                <div>
                                    <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500"><Lock size={12} /> Lock a size to stop further entries</p>
                                    <div className="flex flex-wrap gap-2" data-testid="qc-locks">
                                        {selectedColors.flatMap(c => sizes.map(sz => {
                                            const on = !!qc.locked[`${c}|${sz}`];
                                            return (
                                                <button key={`${c}|${sz}`} type="button" aria-pressed={on} onClick={() => toggleLock(c, sz)}
                                                    data-testid={`lock-${c}-${sz}`}
                                                    className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${on ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100'}`}>
                                                    {on && <Lock size={10} className="mr-1 inline" />}{c} · {sz}
                                                </button>
                                            );
                                        }))}
                                    </div>
                                </div>
                            )}
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
                <TabsContent value="materials">
                    <Card className="border-slate-200" data-testid="materials-card">
                        <CardHeader className="pb-3"><CardTitle className="text-base font-outfit">Materials this lot needs</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            <p className="text-xs text-slate-500">
                                List what the lot consumes. The amount to buy adds a wastage buffer to the planned pieces ({totalPlanned.toLocaleString('en-IN')} pcs),
                                then subtracts what is already in the store or on order. Purchase orders are drafted for you, never sent.
                            </p>
                            <div className="w-40">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Wastage buffer %</Label>
                                <Input type="text" inputMode="decimal" value={postPct} onChange={e => setPostPct(rateText(e.target.value))}
                                    placeholder="0" className="mt-1 font-mono" data-testid="post-pct" />
                            </div>
                            {reqs.map((r, i) => {
                                const it = stockItems.find(x => x.id === r.item_id);
                                return (
                                    <div key={r.uid} className="grid grid-cols-12 items-end gap-2 rounded-md border border-slate-200 bg-slate-50/50 p-2" data-testid={`req-row-${i}`}>
                                        <div className="col-span-12 sm:col-span-4">
                                            <select className={`${selectCls} w-full`} value={r.item_id} onChange={e => patchReq(r.uid, { item_id: e.target.value })}
                                                aria-label={`Material ${i + 1}`} data-testid={`req-item-${i}`}>
                                                <option value="">Choose material</option>
                                                {stockItems.map(x => <option key={x.id} value={x.id}>{x.name} ({x.uom})</option>)}
                                            </select>
                                        </div>
                                        <div className="col-span-5 sm:col-span-3">
                                            <select className={`${selectCls} w-full`} value={r.basis} onChange={e => patchReq(r.uid, { basis: e.target.value })}
                                                aria-label={`Basis ${i + 1}`} data-testid={`req-basis-${i}`}>
                                                <option value="per_piece">Per piece</option><option value="total">Total for the lot</option>
                                            </select>
                                        </div>
                                        <div className="col-span-4 sm:col-span-2">
                                            <Input type="text" inputMode="decimal" value={r.qty} placeholder={it ? it.uom : 'qty'}
                                                onChange={e => patchReq(r.uid, { qty: rateText(e.target.value) })} className="font-mono"
                                                aria-label={`Quantity ${i + 1}`} data-testid={`req-qty-${i}`} />
                                        </div>
                                        <div className="col-span-3 sm:col-span-2 text-right text-[11.5px] text-slate-500" data-testid={`req-gross-${i}`}>
                                            {r.item_id && parseFloat(r.qty) > 0 ? <>need <strong className="tnum text-slate-800">{grossFor(r).toLocaleString('en-IN')}</strong> {it?.uom}</> : ''}
                                        </div>
                                        <div className="col-span-12 sm:col-span-1 text-right">
                                            <Button variant="ghost" size="sm" className="text-red-500" aria-label={`Remove material ${i + 1}`}
                                                onClick={() => setReqs(reqs.filter(x => x.uid !== r.uid))}><Trash2 size={14} /></Button>
                                        </div>
                                    </div>
                                );
                            })}
                            {stockItems.length === 0 && <p className="text-xs text-amber-600">Add items on the Stock page first.</p>}
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => setReqs([...reqs, newReq()])} className="gap-1.5" data-testid="add-requirement"><Plus size={14} /> Add material</Button>
                                {isEdit && reqs.length > 0 && !dirty && (
                                    <Button variant="outline" onClick={regenerate} className="gap-1.5" data-testid="regenerate-po"><FileText size={14} /> Draft purchase orders again</Button>)}
                                {isEdit && <Button variant="ghost" onClick={() => navigate(`/purchase-orders?lot=${id}`)}>Open this lot's orders</Button>}
                            </div>
                            {isEdit && reqs.length > 0 && dirty && <p className="text-[11.5px] text-slate-400">Save your changes first, then orders can be drafted again.</p>}
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
