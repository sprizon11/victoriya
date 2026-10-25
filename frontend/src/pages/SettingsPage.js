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
import { Save, AlertTriangle, Settings, ShieldCheck } from 'lucide-react';

export default function SettingsPage() {
    const [settings, setSettings] = useState({});
    const [weekDef, setWeekDef] = useState('monday_sunday');
    const [saving, setSaving] = useState(false);
    const [resetConfirm, setResetConfirm] = useState('');
    const [resetting, setResetting] = useState(false);
    const [policy, setPolicy] = useState(null);       // { policies, labels, require_second_approver }
    const [savingPolicy, setSavingPolicy] = useState(false);

    useEffect(() => {
        api.get('/settings').then(r => {
            setSettings(r.data);
            setWeekDef(r.data.week_definition || 'monday_sunday');
        }).catch(() => toast.error('Failed to load settings'));
        api.get('/approvals/policies').then(r => setPolicy(r.data)).catch(() => {});
    }, []);

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
