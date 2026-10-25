import { useCallback, useEffect, useState } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react';

/**
 * Create / rename / delete the groups behind a master list. A group that still
 * has members cannot be deleted; the API says so and we show its message.
 */
export default function GroupManager({ open, onOpenChange, endpoint, title, noun, onChanged }) {
    const [groups, setGroups] = useState([]);
    const [name, setName] = useState('');
    const [editId, setEditId] = useState(null);
    const [editName, setEditName] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => api.get(endpoint).then(r => setGroups(r.data)).catch(() => toast.error('Could not load groups')), [endpoint]);
    useEffect(() => { if (open) load(); }, [open, load]);

    const run = async (fn, okMsg) => {
        setBusy(true);
        try { await fn(); if (okMsg) toast.success(okMsg); await load(); onChanged?.(); }
        catch (err) { toast.error(err.response?.data?.detail || 'Something went wrong'); }
        finally { setBusy(false); }
    };

    const add = () => {
        if (!name.trim()) return toast.error('Give the group a name');
        run(async () => { await api.post(endpoint, { name: name.trim() }); setName(''); }, 'Group added');
    };
    const rename = (g) => {
        if (!editName.trim()) return toast.error('Name cannot be empty');
        run(async () => { await api.put(`${endpoint}/${g.id}`, { name: editName.trim() }); setEditId(null); }, 'Group renamed');
    };
    const remove = (g) => {
        if (!window.confirm(`Delete the group "${g.name}"?`)) return;
        run(() => api.delete(`${endpoint}/${g.id}`), 'Group deleted');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" data-testid="group-manager">
                <DialogHeader><DialogTitle className="font-outfit">{title}</DialogTitle></DialogHeader>
                <div className="space-y-3 py-1">
                    <div className="flex gap-2">
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder={`New ${noun} group, e.g. ${noun === 'operator' ? 'Line A' : 'Stitching'}`}
                            onKeyDown={e => e.key === 'Enter' && add()} data-testid="group-name-input" />
                        <Button onClick={add} disabled={busy} data-testid="group-add-button"><Plus size={14} /> Add</Button>
                    </div>
                    <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {groups.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-slate-400">No groups yet.</li>}
                        {groups.map(g => (
                            <li key={g.id} className="flex items-center gap-2 px-3 py-2" data-testid={`group-row-${g.id}`}>
                                {editId === g.id ? (
                                    <>
                                        <Input className="h-8" value={editName} autoFocus onChange={e => setEditName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' ? rename(g) : e.key === 'Escape' && setEditId(null)} />
                                        <Button variant="ghost" size="iconSm" onClick={() => rename(g)} aria-label="Save name"><Check size={14} /></Button>
                                        <Button variant="ghost" size="iconSm" onClick={() => setEditId(null)} aria-label="Cancel"><X size={14} /></Button>
                                    </>
                                ) : (
                                    <>
                                        <span className="flex-1 truncate text-[13px] font-medium text-slate-800">{g.name}</span>
                                        <span className="text-[11px] text-slate-400">{g.member_count} {g.member_count === 1 ? noun : `${noun}s`}</span>
                                        <Button variant="ghost" size="iconSm" onClick={() => { setEditId(g.id); setEditName(g.name); }}
                                            aria-label={`Rename ${g.name}`}><Pencil size={13} /></Button>
                                        <Button variant="ghost" size="iconSm" className="text-red-500" onClick={() => remove(g)}
                                            aria-label={`Delete ${g.name}`} data-testid={`group-delete-${g.id}`}><Trash2 size={13} /></Button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </DialogContent>
        </Dialog>
    );
}
