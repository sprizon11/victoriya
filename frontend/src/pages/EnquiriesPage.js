import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Panel } from '../components/ui/primitives';
import { Button } from '../components/ui/button';
import api from '../lib/api';

export default function EnquiriesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const { data } = await api.get(`/enquiries?skip=${skip}`); setItems(data.items); setTotal(data.total); }
    catch { setError('Could not load enquiries. Please retry.'); }
    finally { setBusy(false); }
  }, [skip]);
  useEffect(() => { load(); }, [load]);
  async function update(item) {
    setBusy(true);
    try { await api.put(`/enquiries/${item.id}`, { status: item.status === 'handled' ? 'new' : 'handled' }); await load(); }
    catch { setError('Could not update the enquiry. Please retry.'); setBusy(false); }
  }
  return <><PageHeader title="Enquiries" subtitle="Website enquiries · email forwarding will be available when email support is configured." actions={<Button onClick={load} disabled={busy} data-testid="enquiries-refresh">Refresh</Button>}/>
    <p role="status" className="mb-3 text-sm">{error || (busy ? 'Loading…' : `${total} enquiries`)}</p>
    {!busy && items.length === 0 && <Panel><p className="p-5">No enquiries yet.</p></Panel>}
    <div className="space-y-4">{items.map(item => <Panel key={item.id}><article className="p-4 break-words" data-testid={`enquiry-item-${item.id}`}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{item.name} {item.company && `· ${item.company}`}</h2><span className="text-sm">{item.status}</span></div><p className="text-sm text-slate-500">{item.created_at?.slice(0,10)}</p><p className="my-2">{item.email}{item.phone && ` · ${item.phone}`}</p><p className="whitespace-pre-wrap my-4">{item.message}</p><Button variant="outline" disabled={busy} onClick={() => update(item)} data-testid={`enquiry-toggle-${item.id}`}>{item.status === 'handled' ? 'Mark new' : 'Mark handled'}</Button></article></Panel>)}</div>
    <div className="mt-4 flex gap-3"><Button variant="outline" disabled={busy || skip === 0} onClick={() => setSkip(skip - 50)} data-testid="enquiries-previous">Previous</Button><Button variant="outline" disabled={busy || skip + 50 >= total} onClick={() => setSkip(skip + 50)} data-testid="enquiries-next">Next</Button></div>
  </>;
}
