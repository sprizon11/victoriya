import { useCallback, useEffect, useState } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import { content as c } from './content';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { Statement, About, Collections } from './sections/Editorial';
import { Reel, Process, Gallery, HowToStart } from './sections/Stories';
import { Contact } from './sections/Contact';
import { ArrowUp, ArrowUpRight, Clock, Mail, MapPin, Phone } from 'lucide-react';
import './landing.css';

const OPTIONAL = ['certifications', 'clients', 'markets', 'testimonials'];

function OptionalSections() {
  return OPTIONAL.map(key => c[key]?.length > 0 ? <section className="vg-section vg-optional" key={key} data-testid={`optional-${key}`}>
    <div className="vg-container"><h2>{c.optionalTitles[key]}</h2><div className="vg-optional-grid">{c[key].map((item, index) => <article key={index}><p>{typeof item === 'string' ? item : item.label || item.text || item.title}</p></article>)}</div></div>
  </section> : null);
}

function Footer() {
  const reduced = useReducedMotion();
  return <footer className="vg-footer"><div className="vg-container">
    <div className="vg-footer-cta"><div><h2>{c.footerCtaTitle}</h2><p>{c.footerCtaText}</p></div>
      <a className="vg-button vg-button-light" href="#contact" data-testid="footer-quote">{c.quote}<ArrowUpRight size={17} aria-hidden="true" /></a></div>
    <div className="vg-footer-grid">
      <div className="vg-footer-brand"><img src="/victoria-logo-white.svg" width="231" height="48" alt={c.logoAlt} /><p>{c.footerLine}</p><p>{c.location}</p></div>
      <nav aria-label={c.menu}><h3>{c.footerExplore}</h3>{c.nav.map(([id, label]) => <a key={id} href={`#${id}`} data-testid={`footer-nav-${id}`}>{label}</a>)}</nav>
      <div className="vg-footer-contact"><h3>{c.footerContact}</h3>
        <a href={`tel:${c.phoneHref}`} data-testid="footer-phone"><Phone size={17} aria-hidden="true" />{c.phone}</a>
        <a href={`mailto:${c.email}`} data-testid="footer-email"><Mail size={17} aria-hidden="true" />{c.email}</a>
        {c.address && <span><MapPin size={17} aria-hidden="true" />{c.address}</span>}
        {c.hours && <span><Clock size={17} aria-hidden="true" />{c.hours}</span>}</div>
    </div>
    <div className="vg-footer-bottom"><span>© {new Date().getFullYear()} {c.copyright}</span><span className="vg-footer-note">{c.imageNote}</span>
      <button type="button" className="vg-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })} data-testid="footer-top">{c.backToTop}<ArrowUp size={16} aria-hidden="true" /></button></div>
  </div>
  <m.div className="vg-footer-wordmark" aria-hidden="true" initial={reduced ? false : { y: 60 }} whileInView={{ y: 0 }} viewport={{ once: true }} transition={{ duration: 0.9 }}><img src="/victoria-logo-white.svg" width="1200" height="251" alt="" /></m.div></footer>;
}

export default function CinematicPage() {
  const [selectedRange, setSelectedRange] = useState('');
  const clearRange = useCallback(() => setSelectedRange(''), []);
  const chooseRange = useCallback(range => {
    setSelectedRange(range);
    document.getElementById('contact')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, []);

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
    return () => created.forEach(element => element.remove());
  }, []);

  return <LazyMotion features={domAnimation}><div className="vg-landing">
    <link rel="preload" as="image" type="image/webp" href="/landing/hero-knits-1280.webp" imageSrcSet={[640,960,1280,1920,2560].map(width => `/landing/hero-knits-${width}.webp ${width}w`).join(', ')} imageSizes="100vw" />
    <a className="vg-skip" href="#main" data-testid="landing-skip">{c.skip}</a>
    <Header />
    <main id="main"><Hero/><Statement/><About/><Collections onChoose={chooseRange}/><Reel/><Process/><Gallery/><HowToStart/><OptionalSections/><Contact selectedRange={selectedRange} onRangeHandled={clearRange}/></main>
    <Footer/>
  </div></LazyMotion>;
}
