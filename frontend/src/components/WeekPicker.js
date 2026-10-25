import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Button } from './ui/button';
import { addDays, dmy, localDate, weekStartOf } from '../lib/utils';

/** Pay-week chooser (Saturday to Friday). Controlled: `value` is the Saturday, YYYY-MM-DD. */
export default function WeekPicker({ value, onChange }) {
    const thisWeek = weekStartOf(localDate());
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2" data-testid="week-picker">
            <CalendarDays size={16} className="text-brand" aria-hidden="true" />
            <div className="mr-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">Pay week</p>
                <p className="text-[13px] font-semibold text-slate-800" data-testid="week-label">Sat {dmy(value)} to Fri {dmy(addDays(value, 6))}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onChange(addDays(value, -7))} aria-label="Previous week" data-testid="week-prev"><ChevronLeft size={14} /></Button>
            <Button variant="outline" size="sm" disabled={value === thisWeek} onClick={() => onChange(thisWeek)} data-testid="week-this">This week</Button>
            <Button variant="outline" size="sm" onClick={() => onChange(addDays(value, 7))} aria-label="Next week" data-testid="week-next"><ChevronRight size={14} /></Button>
            <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-slate-500">
                Jump to
                <input type="date" aria-label="Jump to the week containing this date" className="h-8 rounded-md border border-input bg-white px-2 text-[12.5px]"
                    value={value} onChange={e => e.target.value && onChange(weekStartOf(e.target.value))} data-testid="week-jump" />
            </label>
        </div>
    );
}
