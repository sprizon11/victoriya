/**
 * Shared building blocks for the Victoria UI.
 *
 * Everything here is presentation only. Motion is CSS-driven (see index.css) so
 * there is no animation library in the bundle and every effect is
 * transform/opacity, which keeps it off the layout thread.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------ money */

export const inr = (n, opts = {}) =>
    (Number(n) || 0).toLocaleString('en-IN', {
        style: 'currency', currency: 'INR',
        minimumFractionDigits: opts.decimals ?? 2,
        maximumFractionDigits: opts.decimals ?? 2,
    });

export const num = (n) => (Number(n) || 0).toLocaleString('en-IN');

/* ---------------------------------------------------- animated counter */

/**
 * Counts up to `value` on mount and whenever it changes.
 * Uses requestAnimationFrame and stops immediately for reduced-motion users.
 */
export function AnimatedNumber({ value, format = num, duration = 650, className }) {
    const [shown, setShown] = useState(0);
    const fromRef = useRef(0);
    const rafRef = useRef();

    useEffect(() => {
        const target = Number(value) || 0;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce) { setShown(target); fromRef.current = target; return; }

        const from = fromRef.current;
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            // easeOutCubic - fast start, gentle settle
            const eased = 1 - Math.pow(1 - t, 3);
            setShown(from + (target - from) * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
            else fromRef.current = target;
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [value, duration]);

    return <span className={cn('tnum', className)}>{format(shown)}</span>;
}

/* ------------------------------------------------------------ page header */

export function PageHeader({ title, subtitle, icon: Icon, actions, children }) {
    return (
        <div className="animate-rise-sm mb-4">
            <div className="flex flex-wrap items-start gap-3">
                {Icon && (
                    <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
                        <Icon size={17} strokeWidth={2} />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <h1 className="font-outfit text-[21px] font-semibold leading-tight text-slate-900">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
                    )}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
            </div>
            {children}
            <div className="rule-brand mt-3 h-px w-full opacity-70" />
        </div>
    );
}

/* -------------------------------------------------------------- stat card */

const TONES = {
    brand: { ring: 'ring-brand/15', bg: 'bg-brand/10', fg: 'text-brand', bar: 'bg-brand' },
    leaf: { ring: 'ring-leaf/20', bg: 'bg-leaf/10', fg: 'text-leaf', bar: 'bg-leaf' },
    amber: { ring: 'ring-amber-500/20', bg: 'bg-amber-500/10', fg: 'text-amber-600', bar: 'bg-amber-500' },
    rose: { ring: 'ring-rose-500/20', bg: 'bg-rose-500/10', fg: 'text-rose-600', bar: 'bg-rose-500' },
    slate: { ring: 'ring-slate-400/20', bg: 'bg-slate-500/10', fg: 'text-slate-600', bar: 'bg-slate-400' },
};

export function StatCard({ label, value, sub, icon: Icon, tone = 'brand', format, loading, i = 0 }) {
    const t = TONES[tone] || TONES.brand;
    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton mt-3 h-7 w-28" />
                <div className="skeleton mt-2 h-2.5 w-16" />
            </div>
        );
    }
    return (
        <div
            style={{ '--i': i }}
            className={cn('lift group relative overflow-hidden rounded-xl border border-border',
                'bg-card p-3.5 shadow-card ring-1 ring-inset', t.ring)}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                    {label}
                </p>
                {Icon && (
                    <div className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md transition-transform duration-200 ease-out-soft group-hover:scale-110', t.bg, t.fg)}>
                        <Icon size={14} strokeWidth={2} />
                    </div>
                )}
            </div>
            <div className="mt-1.5 font-outfit text-[26px] font-semibold leading-none text-slate-900">
                {typeof value === 'number'
                    ? <AnimatedNumber value={value} format={format || num} />
                    : <span className="tnum">{value}</span>}
            </div>
            {sub && <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p>}
            <span className={cn('bar-grow absolute inset-x-0 bottom-0 h-[3px] opacity-80', t.bar)} />
        </div>
    );
}

/* ------------------------------------------------------------- surfaces */

export function Panel({ title, subtitle, actions, children, className, bodyClass, i = 0 }) {
    return (
        <section
            style={{ '--i': i }}
            className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-card', className)}
        >
            {(title || actions) && (
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
                    <div className="min-w-0">
                        {title && <h2 className="font-outfit text-[14px] font-semibold text-slate-800">{title}</h2>}
                        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
                    </div>
                    {actions && <div className="flex flex-wrap items-center gap-1.5 print:hidden">{actions}</div>}
                </header>
            )}
            <div className={cn(bodyClass ?? 'p-4')}>{children}</div>
        </section>
    );
}

/* ---------------------------------------------------------- empty state */

export function EmptyState({ icon: Icon, title, message, action, compact }) {
    return (
        <div className={cn('animate-fade-in flex flex-col items-center justify-center text-center',
            compact ? 'py-8' : 'py-14')}>
            {Icon && (
                <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                    <Icon size={22} strokeWidth={1.6} />
                </div>
            )}
            <p className="font-outfit text-[15px] font-medium text-slate-700">{title}</p>
            {message && <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{message}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

/* ------------------------------------------------------------- skeletons */

export function SkeletonRows({ rows = 6, cols = 5 }) {
    return (
        <div className="divide-y divide-border/70">
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex items-center gap-3 px-4 py-2.5">
                    {Array.from({ length: cols }).map((_, c) => (
                        <div key={c} className="skeleton h-3.5 flex-1"
                            style={{ maxWidth: c === 0 ? '28%' : '16%', opacity: 1 - r * 0.1 }} />
                    ))}
                </div>
            ))}
        </div>
    );
}

/* ---------------------------------------------------------------- misc */

export function Pill({ children, tone = 'slate', className }) {
    const tones = {
        slate: 'bg-slate-100 text-slate-600 ring-slate-200',
        brand: 'bg-brand/10 text-brand ring-brand/20',
        leaf: 'bg-leaf/10 text-leaf ring-leaf/20',
        amber: 'bg-amber-50 text-amber-700 ring-amber-200',
        rose: 'bg-rose-50 text-rose-700 ring-rose-200',
        green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    };
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5',
            'text-[10.5px] font-semibold ring-1 ring-inset', tones[tone] || tones.slate, className)}>
            {children}
        </span>
    );
}

/**
 * Progress meter. Anything over 100% is clamped for the bar but the real
 * number is still shown, so an over-produced lot is obvious rather than hidden.
 */
export function Meter({ value, tone, className, showLabel = true }) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    const over = (Number(value) || 0) > 100;
    const auto = over ? 'bg-rose-500' : pct >= 90 ? 'bg-leaf' : pct >= 45 ? 'bg-brand' : 'bg-amber-500';
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-150 bg-slate-200">
                <div className={cn('bar-grow h-full rounded-full', tone || auto)}
                    style={{ width: `${pct}%` }} />
            </div>
            {showLabel && (
                <span className={cn('tnum w-11 text-right text-[11px] font-semibold',
                    over ? 'text-rose-600' : 'text-slate-600')}>
                    {(Number(value) || 0).toFixed(0)}%
                </span>
            )}
        </div>
    );
}

/** Section label used above grouped form fields. */
export function FieldLabel({ children, required }) {
    return (
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
            {children}{required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
    );
}
