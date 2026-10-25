import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Phone, ArrowRight } from 'lucide-react';
import { content as c } from './content';
import { BACKEND_URL } from '../lib/api';
import './landing.css';

export default function LandingPage() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    document.title = 'Victoria Garments — Garment manufacturer in Tiruppur';
    const elements = document.querySelectorAll('.vg-reveal');
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('vg-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setNotice('');
    try {
      const response = await fetch(`${BACKEND_URL}/api/public/enquiry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (!response.ok) { setNotice(response.status === 429 ? c.rateError : c.error); return; }
      setNotice(c.success); form.reset();
    } catch { setNotice(c.error); } finally { setBusy(false); }
  }
  return <div className="vg-landing">
    <a className="vg-skip" href="#main" data-testid="landing-skip">{c.skip}</a>
    <header className="vg-header"><a href="#" aria-label={c.name} data-testid="landing-logo"><img src="/victoria-logo-mark-blue.png" width="190" height="40" alt={c.name} /></a>
      <nav aria-label="Main navigation">{c.nav.map(([id, text]) => <a key={id} href={`#${id}`} data-testid={`nav-${id}`}>{text}</a>)}</nav>
      <Link className="vg-staff" to="/login" data-testid="landing-staff">{c.staff}</Link>
      <a className="vg-button vg-nav-quote" href="#contact" data-testid="nav-quote">{c.quote}<ArrowUpRight size={16}/></a>
    </header>
    <main id="main">
      <section className="vg-hero">
        <picture><source type="image/webp" srcSet="/landing/hero.webp 1920w, /landing/hero@2x.webp 3840w" sizes="100vw"/><img src="/landing/hero.jpg" width="1920" height="1080" alt={c.heroAlt} fetchPriority="high" /></picture>
        <div className="vg-hero-copy"><p className="vg-eyebrow">{c.eyebrow}</p><h1>{c.headline}</h1><p>{c.intro}</p><div className="vg-actions"><a className="vg-button" href="#contact" data-testid="hero-quote">{c.quote}<ArrowUpRight size={18}/></a><a className="vg-call" href={`tel:${c.phoneHref}`} data-testid="hero-call"><Phone size={16}/>{c.call}</a></div></div>
        <div className="vg-hero-bottom"><span>{c.tagline}</span><span>{c.location}</span></div>
      </section>
      <section id="about" className="vg-section vg-about vg-reveal"><div><p className="vg-eyebrow">{c.aboutLabel}</p><h2>{c.aboutTitle}</h2></div><div>{c.about.map(text => <p key={text}>{text}</p>)}{c.stats.map(stat => <p key={stat.label}><strong>{stat.value}</strong> {stat.label}</p>)}</div></section>
      <section id="collection" className="vg-section vg-collection"><p className="vg-eyebrow">{c.collectionLabel}</p><h2>{c.collectionTitle}</h2><div className="vg-products">{c.products.map((p, i) => <article key={p.title} className="vg-product vg-reveal"><img src={`/landing/${p.image}`} width="960" height="1200" loading="lazy" alt={p.alt}/><div><span className="vg-index">0{i + 1}</span><h3>{p.title}</h3><p>{p.description}</p><a href="#contact" data-testid={`product-${i}`} aria-label={`${c.quote}: ${p.title}`}><ArrowUpRight/></a></div></article>)}</div></section>
      <section id="process" className="vg-section vg-process"><p className="vg-eyebrow">{c.processLabel}</p><h2>{c.processTitle}</h2><p>{c.processIntro}</p><ol>{c.steps.map(([title, text, file, alt], i) => <li className="vg-reveal" key={file}><img src={`/landing/process-${file}.webp`} width="800" height="600" loading="lazy" alt={`${c.illustrative}: ${alt}`}/><span className="vg-index">0{i + 1}</span><h3>{title}</h3><p>{text}</p></li>)}</ol><p className="vg-image-note">{c.imageNote}</p></section>
      {c.certifications.length > 0 && <section className="vg-section"><h2>{c.qualityTitle}</h2>{c.certifications.map(text => <p key={text}>{text}</p>)}</section>}
      {c.gallery.length > 0 && <section className="vg-section"><h2>{c.galleryTitle}</h2>{c.gallery.map(img => <img key={img.src} {...img} loading="lazy" alt={img.alt}/>)}</section>}
      <img className="vg-texture" src="/landing/texture-knit.webp" width="1600" height="600" loading="lazy" alt=""/>
      <section id="contact" className="vg-section vg-contact"><div><p className="vg-eyebrow">{c.contactLabel}</p><h2>{c.contactTitle}</h2><p>{c.contactIntro}</p><address><a href={`tel:${c.phoneHref}`} data-testid="contact-phone">{c.phone}</a><a href={`mailto:${c.email}`} data-testid="contact-email">{c.email}</a><span>{c.address || c.location}</span>{c.hours && <span>{c.hours}</span>}<a href="https://www.google.com/maps/search/?api=1&query=Tiruppur%20Tamil%20Nadu" data-testid="contact-map">{c.directions}<ArrowUpRight size={14}/></a>{c.whatsapp && <a href={`https://wa.me/${c.whatsapp}`} data-testid="contact-whatsapp">{c.whatsappLabel}</a>}</address></div>
        <form onSubmit={submit}><p>{c.required}</p><div className="vg-form-grid">{['name', 'company', 'email', 'phone'].map(field => <label key={field} htmlFor={`enquiry-${field}`}>{c.fields[field]}{['name','email'].includes(field) ? ' *' : ''}<input id={`enquiry-${field}`} name={field} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} required={['name','email'].includes(field)} maxLength={{ name:100, company:150, email:254, phone:40 }[field]} autoComplete={{ name:'name', company:'organization', email:'email', phone:'tel' }[field]} data-testid={`enquiry-${field}`}/></label>)}</div>
          <label htmlFor="enquiry-message">{c.fields.message} *<textarea id="enquiry-message" name="message" required maxLength="1500" rows="5" aria-describedby="message-help" data-testid="enquiry-message"/></label><small id="message-help">{c.messageHelp}</small>
          <div className="vg-honeypot" aria-hidden="true"><label>{c.fields.website}<input name="website" tabIndex="-1" autoComplete="off" maxLength="200" data-testid="enquiry-website"/></label></div>
          <button className="vg-button" disabled={busy} data-testid="enquiry-submit">{busy ? c.sending : c.submit}<ArrowRight size={18}/></button><small>{c.privacy}</small><p role="status" aria-live="polite" data-testid="enquiry-status">{notice}</p>
        </form>
      </section>
    </main>
    <footer><img src="/victoria-logo-mark-blue.png" width="160" height="34" alt={c.name}/><span>© {new Date().getFullYear()} {c.copyright}</span><Link to="/login" data-testid="footer-staff">{c.staff}</Link></footer>
  </div>;
}
