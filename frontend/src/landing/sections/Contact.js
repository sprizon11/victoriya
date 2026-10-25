import { useEffect, useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Building2, Check, Clock, Lock, Mail, MapPin, MessageCircle, Phone, User, AlertCircle } from 'lucide-react';
import { content as c } from '../content';
import { BACKEND_URL } from '../../lib/api';
import { Reveal, stagger } from '../motion';

const limits = { name: 100, company: 150, email: 254, phone: 40, message: 1500 };
const empty = { name: '', company: '', email: '', phone: '', message: '', website: '' };
const icons = { name: User, company: Building2, email: Mail, phone: Phone };

// The chips write the same opening sentence the "Ask about this range" links write, so both routes agree.
const withInterest = (message, label) => {
  const rest = message.replace(new RegExp(`^${c.rangePreface}[^.]*\\.\\s*`), '');
  return `${c.rangePreface} ${label}. ${rest}`;
};

function ContactCard({ icon: Icon, label, value, href, external, testid }) {
  const body = <><span className="vg-contact-icon"><Icon size={20} aria-hidden="true" /></span>
    <span><small>{label}</small><strong>{value}</strong></span>{href && <ArrowUpRight className="vg-contact-go" size={18} aria-hidden="true" />}</>;
  return href ? <a className="vg-contact-card" href={href} data-testid={testid} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{body}</a>
    : <div className="vg-contact-card">{body}</div>;
}

export function Contact({ selectedRange, onRangeHandled }) {
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sent, setSent] = useState(false);
  const [interest, setInterest] = useState('');
  const messageRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!selectedRange) return;
    setValues(previous => ({ ...previous, message: withInterest(previous.message, selectedRange) }));
    setErrors(previous => ({ ...previous, message: '' }));
    if (c.interests.includes(selectedRange)) setInterest(selectedRange);
    setSent(false);
    onRangeHandled();
    setTimeout(() => messageRef.current?.focus(), 250);
  }, [selectedRange, onRangeHandled]);

  function validate(field, value) {
    if (['name', 'email', 'message'].includes(field) && !value.trim()) return c.requiredError;
    if (field === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())) return c.emailError;
    if (value.includes('<') || value.includes('>')) return c.plainTextError;
    return '';
  }
  function update(field, value) {
    setValues(previous => ({ ...previous, [field]: value }));
    if (errors[field]) setErrors(previous => ({ ...previous, [field]: validate(field, value) }));
  }
  function chooseInterest(label) {
    const next = interest === label ? '' : label;
    setInterest(next);
    if (next) setValues(previous => ({ ...previous, message: withInterest(previous.message, next).slice(0, limits.message) }));
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
      setNotice(c.success); setValues(empty); setErrors({}); setInterest(''); setSent(true);
    } catch { setNotice(c.error); } finally { setBusy(false); }
  }
  function again() { setSent(false); setNotice(''); }

  const field = (key, index) => {
    const Icon = icons[key];
    const required = ['name', 'email'].includes(key);
    return <Reveal key={key} delay={index * stagger}><div className="vg-field">
      <label htmlFor={`enquiry-${key}`} className="vg-field-label"><span>{c.fields[key]}{required && <span className="vg-req" aria-hidden="true"> *</span>}</span>{!required && <span className="vg-optional-tag">{c.optionalTag}</span>}</label>
      <div className="vg-input"><Icon size={18} aria-hidden="true" />
        <input id={`enquiry-${key}`} name={key} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={values[key]}
          onChange={event => update(key, event.target.value)} onBlur={event => setErrors(previous => ({ ...previous, [key]: validate(key, event.target.value) }))}
          required={required} maxLength={limits[key]} autoComplete={{ name: 'name', company: 'organization', email: 'email', phone: 'tel' }[key]}
          placeholder={c.placeholders[key]} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : undefined} data-testid={`enquiry-${key}`} /></div>
      {errors[key] && <span className="vg-field-error" id={`${key}-error`}><AlertCircle size={15} aria-hidden="true" />{errors[key]}</span>}
    </div></Reveal>;
  };

  return <section id="contact" className="vg-contact vg-section"><div className="vg-container vg-contact-grid">
    <Reveal><p className="vg-eyebrow">{c.contactLabel}</p><h2>{c.contactTitle}</h2><p>{c.contactIntro}</p>
      <address className="vg-contact-info">
        <ContactCard icon={Phone} label={c.call} value={c.phone} href={`tel:${c.phoneHref}`} testid="contact-phone" />
        <ContactCard icon={Mail} label={c.emailLabel} value={c.email} href={`mailto:${c.email}`} testid="contact-email" />
        {c.whatsapp && <ContactCard icon={MessageCircle} label={c.whatsappLabel} value={c.whatsappLabel} href={`https://wa.me/${c.whatsapp}`} external testid="contact-whatsapp" />}
        {c.address && <ContactCard icon={MapPin} label={c.visitLabel} value={c.address} />}
        {c.hours && <ContactCard icon={Clock} label={c.hoursLabel} value={c.hours} />}
        <ContactCard icon={MapPin} label={c.location} value={c.directions} href="https://www.google.com/maps/search/?api=1&query=Tiruppur%20Tamil%20Nadu" external testid="contact-map" />
      </address>
    </Reveal>

    <form onSubmit={submit} noValidate className="vg-form" data-testid="enquiry-form" aria-busy={busy}>
      <div className="vg-form-head"><h3>{c.formTitle}</h3><p>{c.formIntro}</p></div>
      {sent ? <div className="vg-success" role="status" aria-live="polite">
        <m.span className="vg-success-mark" initial={reduced ? false : { scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}><Check size={34} aria-hidden="true" /></m.span>
        <h3>{c.successTitle}</h3><p data-testid="enquiry-status">{notice}</p><p className="vg-success-note">{c.successNote}</p>
        <button type="button" className="vg-button vg-button-outline" onClick={again} data-testid="enquiry-again">{c.again}</button>
      </div> : <div className="vg-form-body">
        <p className="vg-form-required">{c.required}</p>
        <fieldset className="vg-interest"><legend>{c.interestLabel}</legend>
          <div className="vg-chips">{c.interests.map(label => <button key={label} type="button" className="vg-chip" aria-pressed={interest === label} onClick={() => chooseInterest(label)} data-testid={`interest-${label.slice(0, 3).toLowerCase()}`}>{label}</button>)}</div>
        </fieldset>
        <div className="vg-form-grid">{['name', 'company', 'email', 'phone'].map(field)}</div>
        <Reveal delay={4 * stagger}><div className="vg-field">
          <label htmlFor="enquiry-message" className="vg-field-label"><span>{c.fields.message}<span className="vg-req" aria-hidden="true"> *</span></span><span className="vg-counter" aria-hidden="true">{values.message.length} / {limits.message}</span></label>
          <textarea ref={messageRef} id="enquiry-message" name="message" value={values.message} onChange={event => update('message', event.target.value)} onBlur={event => setErrors(previous => ({ ...previous, message: validate('message', event.target.value) }))}
            required maxLength={limits.message} rows="5" placeholder={c.placeholders.message} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'message-help message-error' : 'message-help'} data-testid="enquiry-message" />
          <small id="message-help">{c.messageHelp}</small>
          {errors.message && <span className="vg-field-error" id="message-error"><AlertCircle size={15} aria-hidden="true" />{errors.message}</span>}
        </div></Reveal>
        <div className="vg-honeypot" aria-hidden="true"><label>{c.fields.website}<input name="website" value={values.website} onChange={event => update('website', event.target.value)} tabIndex="-1" autoComplete="off" maxLength="200" data-testid="enquiry-website" /></label></div>
        <button className="vg-button vg-button-blue vg-submit" type="submit" disabled={busy} data-testid="enquiry-submit">{busy && <span className="vg-spinner" aria-hidden="true" />}{busy ? c.sending : c.submit}{!busy && <ArrowRight size={18} aria-hidden="true" />}</button>
        <p className="vg-form-note"><Lock size={14} aria-hidden="true" />{c.privacy}</p>
        <p className="vg-status" role="status" aria-live="polite" data-testid="enquiry-status">{!sent && notice}</p>
      </div>}
    </form>
  </div></section>;
}
