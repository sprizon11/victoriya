import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { PageHeader } from '../components/ui/primitives';
import { Switch } from '../components/ui/switch';
import { Save, AlertTriangle, Settings, ShieldCheck, Mail, Send } from 'lucide-react';

export default function SettingsPage() {
    const [settings, setSettings] = useState({});
    const [weekDef, setWeekDef] = useState('monday_sunday');
    const [saving, setSaving] = useState(false);
    const [resetConfirm, setResetConfirm] = useState('');
    const [resetting, setResetting] = useState(false);
    const [policy, setPolicy] = useState(null);       // { policies, labels, require_second_approver }
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [mail, setMail] = useState(null);                 // /email/settings
    const [mailLog, setMailLog] = useState([]);
    const [testTo, setTestTo] = useState('');
    const [mailBusy, setMailBusy] = useState('');

    useEffect(() => {
        api.get('/settings').then(r => {
            setSettings(r.data);
            setWeekDef(r.data.week_definition || 'monday_sunday');
        }).catch(() => toast.error('Failed to load settings'));
        api.get('/approvals/policies').then(r => setPolicy(r.data)).catch(() => {});
        loadMail();
    }, []);

    const loadMail = () => {
        api.get('/email/settings').then(r => setMail(r.data)).catch(() => {});
        api.get('/email/log?limit=15').then(r => setMailLog(r.data)).catch(() => {});
    };
    const patchReport = (key, patch) => setMail(m => ({ ...m, reports: { ...m.reports, [key]: { ...m.reports[key], ...patch } } }));
    const saveMail = async () => {
        setMailBusy('save');
        try {
            const reports = Object.fromEntries(Object.entries(mail.reports).map(([k, v]) => [k, {
                enabled: v.enabled, schedule: v.schedule, format: v.format,
                recipients: (typeof v.recipientsText === 'string' ? v.recipientsText : v.recipients.join(', ')).split(/[,;\s]+/).filter(Boolean) }]));
            const r = await api.put('/email/settings', { reports, include_names: mail.include_names });
            setMail({ ...mail, ...r.data }); toast.success('Email settings saved');
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save', { duration: 7000 }); }
        finally { setMailBusy(''); }
    };
    const sendNow = async (key) => {
        setMailBusy(key);
        try {
            const r = await api.post(`/email/send/${key}`);
            if (r.data.status === 'ok') toast.success('Sent'); else toast.message(`Not sent: ${r.data.message}`, { duration: 7000 });
            loadMail();
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not send'); }
        finally { setMailBusy(''); }
    };
    const sendTest = async () => {
        setMailBusy('test');
        try { await api.post('/email/test', { to: testTo }); toast.success('Test email sent'); }
        catch (err) { toast.error(err.response?.data?.detail || 'Could not send', { duration: 8000 }); }
        finally { setMailBusy(''); loadMail(); }
    };

    const savePolicy = async () => {
        setSavingPolicy(true);
        try {
            const r = await api.put('/approvals/policies', {
                policies: policy.policies, require_second_approver: policy.require_second_approver });
            setPolicy({ ...policy, ...r.data });
            toast.success('Approval rules saved');
        } catch (err) { toast.error(err.response?.data?.detail || 'Could not save approval rules'); }
        finally { setSavingPolicy(false); }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put('/settings/week_definition', { value: weekDef });
            toast.success('Settings saved');
        } catch { toast.error('Error saving settings'); }
        finally { setSaving(false); }
    };

    return (
        <div className="space-y-4 max-w-2xl" data-testid="settings-page">
            <PageHeader title="System settings" subtitle="Configuration and data management" icon={Settings} />

            <Card className="border-slate-200">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-outfit">Payroll Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Week Definition</Label>
                        <p className="text-xs text-slate-400 mb-2">This determines how weeks are calculated for payroll</p>
                        <Select value={weekDef} onValueChange={setWeekDef}>
                            <SelectTrigger className="max-w-sm" data-testid="week-definition-select">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="monday_sunday">Monday to Sunday</SelectItem>
                                <SelectItem value="sunday_saturday">Sunday to Saturday</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Currency</p>
                        <p className="text-sm text-slate-800 font-medium">INR - Indian Rupee</p>
                    </div>

                    <Button onClick={handleSave} disabled={saving} data-testid="save-settings-button">
                        <Save size={15} /> {saving ? 'Saving...' : 'Save Settings'}
                    </Button>
                </CardContent>
            </Card>

            {mail && (
                <Card className="border-slate-200" data-testid="email-card">
                    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base font-outfit"><Mail size={16} /> Email reports</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                        {!mail.configured ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200" data-testid="email-not-configured">
                                Email is not set up yet, so nothing is sent. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>SMTP_FROM</code> to the server's environment (see DEPLOY.md). You can still choose reports and recipients now.</p>
                        ) : <p className="text-xs text-emerald-700">Sending from {mail.from}.</p>}
                        {!mail.cron_token_set && <p className="text-xs text-slate-500">Scheduled sending also needs <code>CRON_TOKEN</code> and an outside timer that calls the app every 15 minutes. "Send now" works without it.</p>}
                        <div className="divide-y divide-border rounded-lg border border-border">
                            {Object.entries(mail.reports).map(([key, r]) => (
                                <div key={key} className="grid grid-cols-12 items-center gap-2 px-3 py-2" data-testid={`email-row-${key}`}>
                                    <label className="col-span-12 flex items-center gap-2 text-[13px] font-medium text-slate-700 sm:col-span-3">
                                        <Switch checked={r.enabled} onCheckedChange={v => patchReport(key, { enabled: v })} aria-label={`Send ${mail.meta[key].label}`} data-testid={`email-enable-${key}`} />{mail.meta[key].label}</label>
                                    <input className="col-span-12 h-8 rounded-md border border-input bg-white px-2 text-[12.5px] sm:col-span-4" placeholder="who gets it (comma separated)"
                                        value={typeof r.recipientsText === 'string' ? r.recipientsText : r.recipients.join(', ')} onChange={e => patchReport(key, { recipientsText: e.target.value })}
                                        aria-label={`Recipients for ${mail.meta[key].label}`} data-testid={`email-to-${key}`} />
                                    <select className="col-span-6 h-8 rounded-md border border-input bg-white px-2 text-[12.5px] sm:col-span-2" value={r.schedule} onChange={e => patchReport(key, { schedule: e.target.value })} aria-label="Schedule">
                                        {mail.schedules.map(sc => <option key={sc} value={sc}>{sc === 'april' ? 'Apr 1, 8, 15' : sc}</option>)}</select>
                                    <select className="col-span-4 h-8 rounded-md border border-input bg-white px-2 text-[12.5px] sm:col-span-2" value={r.format} onChange={e => patchReport(key, { format: e.target.value })} aria-label="Format">
                                        {mail.formats.map(f => <option key={f} value={f}>{f === 'both' ? 'PDF + Excel' : f}</option>)}</select>
                                    <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1" disabled={!!mailBusy} onClick={() => sendNow(key)} title="Send now" aria-label={`Send ${mail.meta[key].label} now`} data-testid={`email-send-${key}`}><Send size={13} /></Button>
                                </div>))}
                        </div>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-[13px] text-slate-700">Include people's names in the advances email<span className="block text-[11px] text-slate-400">Off: only totals are mailed.</span></span>
                            <Switch checked={!!mail.include_names} onCheckedChange={v => setMail({ ...mail, include_names: v })} data-testid="email-names" /></label>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={saveMail} disabled={!!mailBusy} data-testid="save-email"><Save size={15} /> {mailBusy === 'save' ? 'Saving...' : 'Save email settings'}</Button>
                            <input className="h-9 w-56 rounded-md border border-input bg-white px-2 text-[13px]" placeholder="send a test to…" value={testTo} onChange={e => setTestTo(e.target.value)} aria-label="Test email address" data-testid="email-test-to" />
                            <Button variant="outline" onClick={sendTest} disabled={!testTo || !!mailBusy} data-testid="email-test">Send test</Button>
                        </div>
                        {mailLog.length > 0 && (
                            <details className="text-[12px] text-slate-500"><summary className="cursor-pointer">Recent sends</summary>
                                <ul className="mt-1 space-y-0.5">{mailLog.map(l => <li key={l.id}>{l.at.slice(0, 16).replace('T', ' ')} · {l.report} · <strong className={l.status === 'ok' ? 'text-emerald-700' : l.status === 'failed' ? 'text-rose-600' : ''}>{l.status}</strong>{l.error && ` · ${l.error}`}</li>)}</ul></details>)}
                    </CardContent>
                </Card>
            )}

            {policy && (
                <Card className="border-slate-200" data-testid="approval-policies-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base font-outfit"><ShieldCheck size={16} /> Approval rules</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-xs text-slate-500">
                            Choose which actions need an approval record. When an administrator does one of these
                            directly it is recorded as auto-approved; when someone else asks, an administrator must approve it.
                        </p>
                        <div className="divide-y divide-border rounded-lg border border-border">
                            {Object.entries(policy.policies).map(([key, on]) => (
                                <label key={key} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
                                    <span className="text-[13px] text-slate-700">{policy.labels[key] || key}</span>
                                    <Switch checked={on} data-testid={`policy-${key}`}
                                        onCheckedChange={v => setPolicy({ ...policy, policies: { ...policy.policies, [key]: v } })} />
                                </label>
                            ))}
                        </div>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-[13px] text-slate-700">
                                Require a second administrator<span className="block text-[11px] text-slate-400">
                                    Off while the unit has one administrator, otherwise nobody could approve their own request.</span>
                            </span>
                            <Switch checked={!!policy.require_second_approver} data-testid="policy-second-approver"
                                onCheckedChange={v => setPolicy({ ...policy, require_second_approver: v })} />
                        </label>
                        <Button onClick={savePolicy} disabled={savingPolicy} data-testid="save-policies-button">
                            <Save size={15} /> {savingPolicy ? 'Saving...' : 'Save approval rules'}
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
