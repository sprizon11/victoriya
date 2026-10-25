import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { downloadFile } from '../lib/api';
import { dmy } from '../lib/utils';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { History, Download, ArrowRight } from 'lucide-react';
import { PageHeader, Panel, EmptyState, inr } from '../components/ui/primitives';

const money = (n) => inr(n, { decimals: 0 });

export default function SalaryHistoryPage() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    useEffect(() => {
        setData(null);
        api.get(`/salary/weeks?page=${page}`).then(r => setData(r.data)).catch(() => toast.error('Could not load the history'));
    }, [page]);
    const items = data?.items || [];

    return (
        <div className="space-y-4" data-testid="salary-history-page">
            <PageHeader title="Salary history" icon={History} subtitle="Every pay week that has been saved, newest first."
                actions={<Button variant="outline" size="sm" disabled={!items.length} onClick={() => downloadFile('/api/salary/export?all=true', 'salary_all_weeks.xlsx').catch(() => toast.error('Export failed'))} data-testid="export-all"><Download size={14} /> Export all to Excel</Button>} />
            <Panel bodyClass="p-0">
                {!data ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-9" />)}</div>
                    : items.length === 0 ? <EmptyState icon={History} title="No weeks saved yet" message="Weeks appear here once you save a worker in the calculator." action={<Button onClick={() => navigate('/salary')}>Open the calculator</Button>} />
                        : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-[13px]" data-testid="history-table">
                                    <thead><tr className="border-b border-border bg-slate-50/70 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <th className="px-4 py-2">Pay week (Sat to Fri)</th><th className="px-2 py-2 text-right">Workers</th><th className="px-2 py-2 text-right">Gross</th>
                                        <th className="px-2 py-2 text-right">Advance</th><th className="px-2 py-2 text-right">Net pay</th><th className="px-3 py-2"><span className="sr-only">Open</span></th></tr></thead>
                                    <tbody>
                                        {items.map(w => (
                                            <tr key={w.week_start} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-slate-50/60" onClick={() => navigate(`/salary/week?week=${w.week_start}`)} data-testid="history-row">
                                                <td className="px-4 py-2.5 font-medium text-slate-800">{dmy(w.week_start)} to {dmy(w.week_end)}</td>
                                                <td className="tnum px-2 py-2.5 text-right">{w.workers}</td>
                                                <td className="tnum px-2 py-2.5 text-right">{money(w.gross)}</td>
                                                <td className="tnum px-2 py-2.5 text-right text-rose-600">{w.advance ? `− ${money(w.advance)}` : '—'}</td>
                                                <td className="tnum px-2 py-2.5 text-right font-semibold text-brand">{money(w.net)}</td>
                                                <td className="px-3 py-2.5 text-right">
                                                    <Button variant="ghost" size="sm" aria-label={`Open week of ${dmy(w.week_start)}`} onClick={(e) => { e.stopPropagation(); navigate(`/salary/week?week=${w.week_start}`); }}><ArrowRight size={14} /></Button></td>
                                            </tr>))}
                                    </tbody>
                                </table>
                            </div>)}
            </Panel>
            {data && data.pages > 1 && (
                <div className="flex items-center justify-center gap-3 text-[12.5px]">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
                    <span className="text-slate-500">Page {page} of {data.pages}</span>
                    <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Older</Button>
                </div>)}
        </div>
    );
}
