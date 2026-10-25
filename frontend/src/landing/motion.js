import { m, useReducedMotion } from 'framer-motion';

export const ease = [0.22, 1, 0.36, 1];
export const revealDuration = 0.7;
export const stagger = 0.08;
export const viewport = { once: true, margin: '-12% 0px' };

export function Reveal({ children, className = '', delay = 0, clip = false, ...props }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className} {...props}>{children}</div>;
  return <m.div className={className}
    initial={clip ? { clipPath: 'inset(100% 0 0 0)' } : { opacity: 1, y: 16 }}
    whileInView={clip ? { clipPath: 'inset(0% 0 0 0)' } : { opacity: 1, y: 0 }}
    viewport={viewport} transition={{ duration: revealDuration, ease, delay }} {...props}>{children}</m.div>;
}
