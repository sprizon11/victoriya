import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import { content as c } from './content';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { Statement, About, Collections } from './sections/Editorial';
import { Reel, Process, Gallery, HowToStart } from './sections/Stories';
import { Contact } from './sections/Contact';
import './landing.css';

const OPTIONAL = ['certifications', 'clients', 'markets', 'testimonials'];

function OptionalSections() {
  return OPTIONAL.map(key => c[key]?.length > 0 ? <section className="vg-section vg-optional" key={key} data-testid={`optional-${key}`}>
    <div className="vg-container"><h2>{c.optionalTitles[key]}</h2><div className="vg-optional-grid">{c[key].map((item, index) => <article key={index}><p>{typeof item === 'string' ? item : item.label || item.text || item.title}</p></article>)}</div></div>
  </section> : null);
}

function Footer() {
  const reduced = useReducedMotion();
  return <footer className="vg-footer"><div className="vg-container"><m.div className="vg-footer-wordmark" initial={reduced ? false : { y: 70 }} whileInView={{ y: 0 }} viewport={{ once: true }} transition={{ duration: 0.9 }}><img src="/victoria-logo-white.svg" width="1200" height="295" alt={c.logoAlt} /></m.div>
    <div className="vg-footer-top"><p>{c.footerLine}</p><nav aria-label={c.menu}>{c.nav.map(([id, label]) => <a key={id} href={`#${id}`} data-testid={`footer-nav-${id}`}>{label}</a>)}<Link to="/login" data-testid="footer-staff">{c.staff}</Link></nav></div>
    <div className="vg-footer-bottom"><span>© {new Date().getFullYear()} {c.copyright}</span><span>{c.imageNote}</span></div></div></footer>;
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
