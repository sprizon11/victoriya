import { useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { PageHeader } from '../components/ui/primitives';
import { Save, AlertTriangle, Settings } from 'lucide-react';

export default function SettingsPage() {
    const [settings, setSettings] = useState({});
    const [weekDef, setWeekDef] = useState('monday_sunday');
    const [saving, setSaving] = useState(false);
    const [resetConfirm, setResetConfirm] = useState('');
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        api.get('/settings').then(r => {
            setSettings(r.data);
            setWeekDef(r.data.week_definition || 'monday_sunday');
        }).catch(() => toast.error('Failed to load settings'));
    }, []);

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
        </div>
    );
}
