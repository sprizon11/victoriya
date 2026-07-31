import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Label } from '../components/ui/label';
import { Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';

// Reversed logo with the navy keyed out, so it sits on the dark background with
// no white plate behind it. The navy version would be invisible here.
const LOGO = "/victoria-logo-mark-light.png";
// The leaf mark on its own, used oversized as a background watermark.
const LEAF = "/victoria-leaf.png";
const BG = "/victoria-login-bg.jpg";

function formatError(detail) {
    if (!detail) return "Something went wrong.";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map(e => e?.msg || JSON.stringify(e)).join(" ");
    if (detail?.msg) return detail.msg;
    return String(detail);
}

const FEATURES = [
    ['Lot & colour', 'size-wise tracking'],
    ['Piece-rate', 'payroll engine'],
    ['Advance', 'ledger & vouchers'],
];

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await login(email, password);
            navigate('/');
        } catch (err) {
            setError(formatError(err.response?.data?.detail) || err.message);
        } finally {
            setLoading(false);
        }
    };

    // Fields sit on the white panel, so they are light with dark text.
    const field =
        "h-[46px] w-full rounded-xl border border-slate-300/70 bg-white/70 pl-11 pr-4 text-[14px] text-slate-900 " +
        "placeholder:text-slate-400 outline-none transition-all duration-200 ease-out-soft " +
        "hover:border-slate-400/70 hover:bg-white/85 " +
        "focus:border-brand/60 focus:bg-white focus:ring-4 focus:ring-brand/15";

    return (
        <div className="grain relative flex min-h-screen items-center overflow-hidden bg-[#0c1c40]">
            {/* ------------------------------------------------ backdrop */}
            <div
                className="absolute inset-0 scale-110 opacity-[0.12] blur-[8px]"
                style={{ backgroundImage: `url(${BG})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                aria-hidden="true"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-[#0a1836] via-[#12295a] to-[#091530]" aria-hidden="true" />

            {/* Coloured light behind the glass card. STATIC - these used to drift,
                which swept light across the leaf watermark below and made the
                watermark itself look like it was sliding across the page. */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <div className="aurora -left-[6%] top-[6%] h-[42vw] w-[42vw] bg-leaf/28" />
                <div className="aurora right-[-6%] top-[26%] h-[40vw] w-[40vw] bg-[#3b7fe0]/28" />
                <div className="aurora bottom-[-12%] left-[30%] h-[32vw] w-[32vw] bg-[#6f57c9]/20" />
            </div>

            {/* Oversized leaf watermark. Bleeds off the left edge and sits behind
                everything - decorative, so it is hidden from assistive tech. */}
            <div className="pointer-events-none absolute -left-[9%] top-1/2 hidden -translate-y-1/2 lg:block"
                aria-hidden="true">
                <img src={LEAF} alt="" className="h-[82vh] max-h-[780px] w-auto opacity-[0.07]" />
            </div>

            <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-col items-center gap-10 px-5 py-12 lg:flex-row lg:justify-between lg:gap-16 lg:py-0">

                {/* ------------------------------------------------ brand side */}
                <div className="w-full max-w-xl text-center lg:text-left">
                    {/* Outer element owns the position, inner one owns the entrance
                        animation. They cannot share an element - the animation drives
                        `transform`, which would override the translate and silently
                        cancel the offset. */}
                    <div className="mx-auto w-fit lg:translate-x-24">
                        <div className="animate-logo-in relative">
                            {/* soft teal bloom behind the mark */}
                            <span aria-hidden="true"
                                className="animate-glow pointer-events-none absolute inset-0 -z-10 scale-[1.35]
                                    rounded-full bg-leaf/25 blur-[46px]" />
                            {/* Gentle 4px breathe over 10s - deliberately half the
                                travel and slower than the earlier float, so it reads
                                as alive rather than as something sliding about. */}
                            <img src={LOGO} alt="Victoria Garments"
                                className="float-gentle block h-16 w-auto sm:h-[88px]" />
                        </div>
                    </div>

                    <h1 className="mt-8 font-outfit text-[38px] font-semibold leading-[1.08] tracking-[-0.02em] text-white sm:text-[46px]">
                        Every piece counted.
                        <span className="mt-1 block bg-gradient-to-r from-leaf via-[#39d8b6] to-[#7fe8d2] bg-clip-text text-transparent">
                            Every rupee accounted for.
                        </span>
                    </h1>

                    <p className="mx-auto mt-5 max-w-md text-[14.5px] leading-relaxed text-white/70 lg:mx-0">
                        Production tracking and piece-rate payroll for Victoria Garments,
                        Tiruppur — from the cutting table to the wage voucher.
                    </p>

                    <div className="mt-9 flex flex-wrap justify-center gap-2.5 lg:justify-start">
                        {FEATURES.map(([a, b]) => (
                            <div key={a}
                                className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-left
                                    transition-all duration-300 ease-out-soft hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.10]">
                                <div className="font-outfit text-[13px] font-semibold text-white">{a}</div>
                                <div className="text-[11px] text-white/60">{b}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ------------------------------------- white frosted glass card */}
                <div className="w-full max-w-[418px] shrink-0" data-testid="login-form">
                    <div className="glass-white glass-edge glass-edge-light relative rounded-[26px] px-7 pb-7 pt-8">
                        <div className="relative z-[2]">
                            <div className="text-center">
                                <h2 className="font-outfit text-[23px] font-semibold tracking-[-0.01em] text-slate-900">
                                    Welcome back
                                </h2>
                                <p className="mt-1 text-[12.5px] text-slate-600">Sign in to continue</p>
                            </div>

                            <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
                                <div className="space-y-1.5">
                                    <Label htmlFor="email"
                                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                                        Email
                                    </Label>
                                    <div className="relative">
                                        <Mail size={16}
                                            className="pointer-events-none absolute left-3.5 top-1/2 z-[2] -translate-y-1/2 text-slate-400" />
                                        <input
                                            id="email" type="email" value={email} autoComplete="username"
                                            onChange={e => { setEmail(e.target.value); setError(''); }}
                                            placeholder="admin@example.com" required
                                            data-testid="login-email-input"
                                            className={field}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="password"
                                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                                        Password
                                    </Label>
                                    <div className="relative">
                                        <Lock size={16}
                                            className="pointer-events-none absolute left-3.5 top-1/2 z-[2] -translate-y-1/2 text-slate-400" />
                                        <input
                                            id="password" type={showPw ? 'text' : 'password'} value={password}
                                            autoComplete="current-password"
                                            onChange={e => { setPassword(e.target.value); setError(''); }}
                                            placeholder="Enter password" required
                                            data-testid="login-password-input"
                                            className={`${field} pr-12`}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPw(v => !v)}
                                            aria-label={showPw ? 'Hide password' : 'Show password'}
                                            className="press absolute right-3 top-1/2 z-[2] -translate-y-1/2 cursor-pointer rounded-md p-1.5
                                                text-slate-400 transition-colors hover:bg-slate-900/5 hover:text-slate-700
                                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                                        >
                                            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                {error && (
                                    <div
                                        role="alert"
                                        className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50/90 px-3.5 py-2.5"
                                        data-testid="login-error"
                                    >
                                        <AlertCircle size={15} className="mt-px shrink-0 text-rose-500" />
                                        <p className="text-[12.5px] leading-snug text-rose-700">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    data-testid="login-submit-button"
                                    className="press group relative mt-1 flex h-[46px] w-full cursor-pointer items-center justify-center gap-2
                                        overflow-hidden rounded-xl bg-gradient-to-r from-brand to-[#3665bb]
                                        text-[14px] font-semibold text-white
                                        shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28),0_10px_28px_-8px_rgba(20,45,105,0.65)]
                                        transition-all duration-200 ease-out-soft
                                        hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.38),0_14px_36px_-8px_rgba(20,45,105,0.8)]
                                        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/30
                                        disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r
                                        from-transparent via-white/25 to-transparent transition-transform duration-700
                                        ease-out-soft group-hover:translate-x-full" />
                                    {loading ? (
                                        <>
                                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                            Signing in…
                                        </>
                                    ) : (
                                        <>
                                            Sign in
                                            <ArrowRight size={16}
                                                className="transition-transform duration-200 ease-out-soft group-hover:translate-x-1" />
                                        </>
                                    )}
                                </button>
                            </form>

                            <div className="mt-6 border-t border-slate-900/10 pt-4 text-center">
                                <p className="text-[10.5px] tracking-wide text-slate-600">
                                    Victoria Garments, Tiruppur &middot; 0421-2479137
                                </p>
                            </div>
                        </div>
                    </div>

                    <p className="mt-5 text-center text-[9.5px] font-medium tracking-[0.3em] text-white/40">
                        VICTORIA UNIT FLOW
                    </p>
                </div>
            </div>
        </div>
    );
}
