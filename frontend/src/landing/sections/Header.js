import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, m, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { content as c } from '../content';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [showBar, setShowBar] = useState(false);
  const panel = useRef(null);
  const toggle = useRef(null);
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', y => setScrolled(y > 80));

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('a')?.focus();
    function keydown(event) {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll('a, button')];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); };
  }, [open]);

  useEffect(() => {
    if (!window.IntersectionObserver) return;
    let heroPassed = false, contactVisible = false;
    const hero = new IntersectionObserver(([entry]) => { heroPassed = !entry.isIntersecting; setShowBar(heroPassed && !contactVisible); });
    const contact = new IntersectionObserver(([entry]) => { contactVisible = entry.isIntersecting; setShowBar(heroPassed && !contactVisible); }, { threshold: 0.05 });
    const heroNode = document.getElementById('hero'), contactNode = document.getElementById('contact');
    if (heroNode) hero.observe(heroNode);
    if (contactNode) contact.observe(contactNode);
    return () => { hero.disconnect(); contact.disconnect(); };
  }, []);

  const close = () => setOpen(false);
  return <>
    <header className={`vg-header ${scrolled ? 'vg-header-solid' : ''}`}><div className="vg-container vg-header-inner">
      <a className="vg-logo" href="/home" data-testid="landing-logo"><img src={scrolled ? '/victoria-logo-color.svg' : '/victoria-logo-white.svg'} width="220" height="54" alt={c.logoAlt} /></a>
      <nav className="vg-desktop-nav" aria-label={c.menu}>{c.nav.map(([id, label]) => <a key={id} href={`#${id}`} data-testid={`nav-${id}`}>{label}</a>)}</nav>
      <div className="vg-header-actions"><Link to="/login" data-testid="landing-staff">{c.staff}</Link><a className="vg-button vg-header-quote" href="#contact" data-testid="nav-quote">{c.quote}<ArrowUpRight size={18}/></a></div>
      <button ref={toggle} className="vg-menu-toggle" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="vg-mobile-menu" aria-label={open ? c.closeMenu : c.menu} data-testid="landing-menu-toggle">{open ? <X/> : <Menu/>}</button>
    </div></header>
    <AnimatePresence>{open && <m.nav ref={panel} id="vg-mobile-menu" className="vg-mobile-sheet" aria-label={c.menu} data-testid="landing-mobile-menu" initial={reduced ? false : { opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? {} : { opacity: 0, y: -20 }} transition={{ duration: 0.35 }}>
      {c.nav.map(([id, label], i) => <m.a key={id} href={`#${id}`} onClick={close} data-testid={`mobile-nav-${id}`} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>{label}<ArrowUpRight size={18}/></m.a>)}
      <Link to="/login" onClick={close} data-testid="mobile-staff">{c.staff}<ArrowUpRight size={18}/></Link>
      <a className="vg-button" href="#contact" onClick={close} data-testid="mobile-menu-quote">{c.quote}<ArrowUpRight size={18}/></a>
    </m.nav>}</AnimatePresence>
    {showBar && <a className="vg-mobile-bar" href="#contact" data-testid="mobile-quote">{c.quote}<ArrowUpRight size={18}/></a>}
  </>;
}
