import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, MapPin, Menu, MessageCircle, Phone, Shirt, X } from 'lucide-react';
import { content as c } from './content';
import { BACKEND_URL } from '../lib/api';
import './landing.css';

const OPTIONAL = ['certifications', 'clients', 'markets', 'gallery', 'testimonials'];
const ICONS = { shirt: Shirt, pin: MapPin, message: MessageCircle };
const limits = { name: 100, company: 150, email: 254, phone: 40, message: 1500 };
const empty = { name: '', company: '', email: '', phone: '', message: '', website: '' };

function ResponsiveImage({ name, alt, width, height, sizes, className = '' }) {
  const base = `/landing/${name}`;
  return <picture className={className}>
    <source type="image/webp" srcSet={[640, 960, 1280, 1920].map(w => `${base}-${w}.webp ${w}w`).join(', ')} sizes={sizes} />
    <img src={`${base}-960.jpg`} srcSet={[640, 960, 1280, 1920].map(w => `${base}-${w}.jpg ${w}w`).join(', ')} sizes={sizes}
      width={width} height={height} loading="lazy" decoding="async" alt={alt} />
  </picture>;
}

function OptionalSections() {
  return OPTIONAL.map(key => c[key]?.length > 0 ? <section className="vg-section vg-optional" key={key} data-testid={`optional-${key}`}>
    <div className="vg-container"><h2>{c.optionalTitles[key]}</h2><div className="vg-optional-grid">{c[key].map((item, i) =>
      <article key={i}>{key === 'gallery' ? <img src={item.src} width={item.width} height={item.height} loading="lazy" alt={item.alt} /> : <p>{typeof item === 'string' ? item : item.label || item.text || item.title}</p>}</article>
    )}</div></div></section> : null);
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState('');
  const [showBar, setShowBar] = useState(false);
  const [heroPassed, setHeroPassed] = useState(false);
  const [contactVisible, setContactVisible] = useState(false);
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  const messageRef = useRef(null);

  useEffect(() => {
    document.title = c.pageTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = c.pageDescription;
    const source = c.canonicalUrl || process.env.REACT_APP_SITE_URL;
    let origin = '';
    if (source) { try { const url = new URL(source); if (url.protocol === 'https:' || url.hostname === 'localhost') origin = url.origin; } catch {} }
    const tags = [
      ['link[rel="canonical"]', 'href', origin ? `${origin}/home` : ''],
      ['meta[property="og:url"]', 'content', origin ? `${origin}/home` : ''],
      ['meta[property="og:image"]', 'content', origin ? `${origin}/landing/og-image.jpg` : ''],
      ['meta[name="twitter:image"]', 'content', origin ? `${origin}/landing/og-image.jpg` : ''],
    ];
    const created = [];
    tags.forEach(([selector, attr, value]) => {
      if (!value) return;
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
        if (selector.startsWith('link')) el.rel = 'canonical';
        else if (selector.includes('twitter')) el.name = 'twitter:image';
        else el.setAttribute('property', selector.includes('og:url') ? 'og:url' : 'og:image');
        document.head.appendChild(el); created.push(el);
      }
      el.setAttribute(attr, value);
    });
    const nodes = document.querySelectorAll('.vg-reveal');
    if (!window.IntersectionObserver) return;
    const reveal = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vg-visible'); reveal.unobserve(e.target); } }), { threshold: 0.08 });
    nodes.forEach(node => reveal.observe(node));
    reveal.observe(document.getElementById('process'));
    const nav = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: '-22% 0px -60% 0px' });
    c.nav.forEach(([id]) => { const el = document.getElementById(id); if (el) nav.observe(el); });
    const hero = new IntersectionObserver(([e]) => setHeroPassed(!e.isIntersecting), { threshold: 0 });
    const contact = new IntersectionObserver(([e]) => setContactVisible(e.isIntersecting), { threshold: 0.08 });
    hero.observe(document.getElementById('hero')); contact.observe(document.getElementById('contact'));
    return () => { reveal.disconnect(); nav.disconnect(); hero.disconnect(); contact.disconnect(); created.forEach(el => el.remove()); };
  }, []);

  useEffect(() => setShowBar(heroPassed && !contactVisible), [heroPassed, contactVisible]);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = menuRef.current;
    panel?.querySelector('a')?.focus();
    function onKey(event) {
      if (event.key === 'Escape') { setMenuOpen(false); toggleRef.current?.focus(); }
      if (event.key !== 'Tab' || !panel) return;
      const nodes = [...panel.querySelectorAll('a,button')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  function goToContact(product) {
    setValues(prev => ({ ...prev, message: `${c.rangePreface} ${product}. ` }));
    setErrors(prev => ({ ...prev, message: '' }));
    document.getElementById('contact')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    setTimeout(() => messageRef.current?.focus(), 250);
  }
  function validate(field, value) {
    if (['name', 'email', 'message'].includes(field) && !value.trim()) return c.requiredError;
    if (field === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())) return c.emailError;
    if (value.includes('<') || value.includes('>')) return c.plainTextError;
    return '';
  }
  function update(field, value) {
    setValues(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: validate(field, value) }));
  }
  async function submit(event) {
    event.preventDefault();
    const next = Object.fromEntries(Object.keys(limits).map(key => [key, validate(key, values[key])]));
    setErrors(next); setNotice('');
    const first = Object.keys(next).find(key => next[key]);
    if (first) { document.getElementById(`enquiry-${first}`)?.focus(); return; }
    setBusy(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/public/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!response.ok) { setNotice(response.status === 429 ? c.rateError : c.error); return; }
      setNotice(c.success); setValues(empty); setErrors({});
    } catch { setNotice(c.error); } finally { setBusy(false); }
  }

  return <div className="vg-landing">
    <a className="vg-skip" href="#main" data-testid="landing-skip">{c.skip}</a>
    <header className="vg-header"><div className="vg-container vg-header-inner">
      <a className="vg-logo" href="/home" data-testid="landing-logo"><img src="/victoria-logo-white.svg" width="220" height="54" alt={c.logoAlt} /></a>
      <nav className="vg-desktop-nav" aria-label={c.menu}>{c.nav.map(([id, label]) => <a key={id} href={`#${id}`} className={active === id ? 'vg-active' : ''} data-testid={`nav-${id}`}>{label}</a>)}</nav>
      <div className="vg-header-actions"><Link to="/login" data-testid="landing-staff">{c.staff}</Link><a className="vg-button vg-button-light" href="#contact" data-testid="nav-quote">{c.quote}<ArrowUpRight size={18}/></a></div>
      <button ref={toggleRef} className="vg-menu-toggle" type="button" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-controls="vg-mobile-menu" aria-label={menuOpen ? c.closeMenu : c.menu} data-testid="landing-menu-toggle">{menuOpen ? <X/> : <Menu/>}</button>
    </div></header>
    {menuOpen && <nav ref={menuRef} id="vg-mobile-menu" className="vg-mobile-sheet" aria-label={c.menu} data-testid="landing-mobile-menu">
      {c.nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} data-testid={`mobile-nav-${id}`}>{label}<ArrowUpRight size={18}/></a>)}
      <Link to="/login" onClick={() => setMenuOpen(false)} data-testid="mobile-staff">{c.staff}<ArrowUpRight size={18}/></Link>
      <a className="vg-button vg-button-light" href="#contact" onClick={() => setMenuOpen(false)} data-testid="mobile-menu-quote">{c.quote}<ArrowRight size={18}/></a>
    </nav>}
    <main id="main">
      <section id="hero" className="vg-hero"><div className="vg-container vg-hero-grid">
        <div className="vg-hero-copy vg-reveal"><p className="vg-eyebrow">{c.eyebrow}</p><h1>{c.headline}</h1><p className="vg-hero-intro">{c.intro}</p>
          <div className="vg-actions"><a className="vg-button vg-button-light" href="#contact" data-testid="hero-quote">{c.quote}<ArrowUpRight size={18}/></a><a className="vg-button vg-button-outline-light" href={`tel:${c.phoneHref}`} data-testid="hero-call"><Phone size={18}/>{c.call}</a></div><p className="vg-hero-phone">{c.phone}</p>
        </div><figure className="vg-hero-figure"><picture><source type="image/webp" srcSet="/landing/hero-640.webp 640w, /landing/hero-960.webp 960w, /landing/hero-1280.webp 1280w, /landing/hero-1920.webp 1920w" sizes="(max-width: 800px) 100vw, 48vw"/><img src="/landing/hero-1280.jpg" srcSet="/landing/hero-640.jpg 640w, /landing/hero-960.jpg 960w, /landing/hero-1280.jpg 1280w, /landing/hero-1920.jpg 1920w" sizes="(max-width: 800px) 100vw, 48vw" width="1920" height="1080" fetchPriority="high" alt={c.heroAlt}/></picture><figcaption>{c.imageCaption}</figcaption></figure>
      </div></section>
      <section className="vg-values vg-section"><div className="vg-container vg-values-grid">{c.values.map(({title, detail, icon}) => { const Icon = ICONS[icon]; return <article className="vg-value vg-reveal" key={title}><Icon size={30} strokeWidth={1.75} aria-hidden="true"/><h2>{title}</h2><p>{detail}</p></article>; })}</div></section>
      <section id="about" className="vg-about vg-section"><div className="vg-container vg-about-grid"><div className="vg-reveal"><p className="vg-eyebrow">{c.aboutLabel}</p><h2>{c.aboutTitle}</h2>{c.about.map(text => <p key={text}>{text}</p>)}</div><ResponsiveImage name="texture-knit" className="vg-texture-frame" width={1600} height={600} sizes="(max-width: 800px) 100vw, 45vw" alt=""/></div>{c.stats.length > 0 && <div className="vg-container vg-stats">{c.stats.map((stat,i) => <article key={i}><strong>{stat.value}</strong><span>{stat.label}</span></article>)}</div>}</section>
      <section id="collection" className="vg-collection vg-section"><div className="vg-container"><p className="vg-eyebrow">{c.collectionLabel}</p><h2>{c.collectionTitle}</h2><div className="vg-product-grid">{c.products.map((product,i) => <article className="vg-product vg-reveal" key={product.title}><ResponsiveImage name={product.image} width={960} height={1200} sizes="(max-width: 720px) 100vw, 45vw" alt={product.alt}/><div className="vg-product-copy"><h3>{product.title}</h3><p>{product.description}</p><button type="button" onClick={() => goToContact(product.title)} data-testid={`product-${i}`}>{c.rangeAction}<ArrowUpRight size={18}/></button></div></article>)}</div></div></section>
      <section id="process" className="vg-process vg-section"><div className="vg-container"><p className="vg-eyebrow">{c.processLabel}</p><h2>{c.processTitle}</h2><p className="vg-process-intro">{c.processIntro}</p><ol className="vg-stepper">{c.steps.map((step,i) => <li className="vg-reveal" key={step.image}><span className="vg-step-marker" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><ResponsiveImage name={`process-${step.image}`} width={800} height={600} sizes="(max-width: 720px) 80vw, 19vw" alt={step.alt}/><h3>{step.title}</h3><p>{step.detail}</p></li>)}</ol></div></section>
      <section className="vg-start vg-section"><div className="vg-container"><p className="vg-eyebrow">{c.startLabel}</p><h2>{c.startTitle}</h2><ol className="vg-start-grid">{c.startSteps.map((step,i) => <li className="vg-reveal" key={step.title}><span>{String(i+1).padStart(2,'0')}</span><h3>{step.title}</h3><p>{step.detail}</p></li>)}</ol></div></section>
      <OptionalSections/>
      <section id="contact" className="vg-contact vg-section"><div className="vg-container vg-contact-grid"><div><p className="vg-eyebrow">{c.contactLabel}</p><h2>{c.contactTitle}</h2><p>{c.contactIntro}</p><address><a href={`tel:${c.phoneHref}`} data-testid="contact-phone">{c.phone}</a><a href={`mailto:${c.email}`} data-testid="contact-email">{c.email}</a>{c.address && <span>{c.address}</span>}{c.hours && <span>{c.hours}</span>}{c.whatsapp && <a href={`https://wa.me/${c.whatsapp}`} data-testid="contact-whatsapp">{c.whatsappLabel}</a>}<a href="https://www.google.com/maps/search/?api=1&query=Tiruppur%20Tamil%20Nadu" data-testid="contact-map">{c.directions}<ArrowUpRight size={17}/></a></address></div>
        <form onSubmit={submit} noValidate className="vg-form" data-testid="enquiry-form"><p>{c.required}</p><div className="vg-form-grid">{['name','company','email','phone'].map(field => <label key={field} htmlFor={`enquiry-${field}`}>{c.fields[field]}{['name','email'].includes(field) && ' *'}<input id={`enquiry-${field}`} name={field} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={values[field]} onChange={e => update(field,e.target.value)} onBlur={e => setErrors(prev => ({...prev,[field]:validate(field,e.target.value)}))} required={['name','email'].includes(field)} maxLength={limits[field]} autoComplete={{name:'name',company:'organization',email:'email',phone:'tel'}[field]} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined} data-testid={`enquiry-${field}`}/>{errors[field] && <span className="vg-field-error" id={`${field}-error`}>{errors[field]}</span>}</label>)}</div>
          <label htmlFor="enquiry-message">{c.fields.message} *<textarea ref={messageRef} id="enquiry-message" name="message" value={values.message} onChange={e => update('message',e.target.value)} onBlur={e => setErrors(prev => ({...prev,message:validate('message',e.target.value)}))} required maxLength={limits.message} rows="5" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'message-help message-error' : 'message-help'} data-testid="enquiry-message"/>{errors.message && <span className="vg-field-error" id="message-error">{errors.message}</span>}</label><small id="message-help">{c.messageHelp}</small>
          <div className="vg-honeypot" aria-hidden="true"><label>{c.fields.website}<input name="website" value={values.website} onChange={e => update('website',e.target.value)} tabIndex="-1" autoComplete="off" maxLength="200" data-testid="enquiry-website"/></label></div>
          <button className="vg-button vg-button-blue vg-submit" type="submit" disabled={busy} data-testid="enquiry-submit">{busy && <span className="vg-spinner" aria-hidden="true"/>}{busy ? c.sending : c.submit}<ArrowRight size={18}/></button><small>{c.privacy}</small><p className="vg-status" role="status" aria-live="polite" data-testid="enquiry-status">{notice}</p>
        </form></div></section>
    </main>
    <footer className="vg-footer"><div className="vg-container"><div className="vg-footer-top"><div><img src="/victoria-logo-white.svg" width="240" height="58" alt={c.logoAlt}/><p>{c.footerLine}</p></div><nav aria-label={c.menu}>{c.nav.map(([id,label]) => <a key={id} href={`#${id}`} data-testid={`footer-nav-${id}`}>{label}</a>)}<Link to="/login" data-testid="footer-staff">{c.staff}</Link></nav></div><div className="vg-footer-bottom"><span>© {new Date().getFullYear()} {c.copyright}</span><span>{c.imageNote}</span></div></div></footer>
    {showBar && <a className="vg-mobile-bar" href="#contact" data-testid="mobile-quote">{c.quote}<ArrowUpRight size={18}/></a>}
  </div>;
}
