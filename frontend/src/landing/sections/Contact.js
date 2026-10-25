import { useEffect, useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react';
import { content as c } from '../content';
import { BACKEND_URL } from '../../lib/api';
import { Reveal, stagger } from '../motion';

const limits = { name: 100, company: 150, email: 254, phone: 40, message: 1500 };
const empty = { name: '', company: '', email: '', phone: '', message: '', website: '' };

export function Contact({ selectedRange, onRangeHandled }) {
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [sent, setSent] = useState(false);
  const messageRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!selectedRange) return;
    const message = `${c.rangePreface} ${selectedRange}. `;
    setValues(previous => ({ ...previous, message }));
    setErrors(previous => ({ ...previous, message: '' }));
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
  async function submit(event) {
    event.preventDefault();
    const next = Object.fromEntries(Object.keys(limits).map(key => [key, validate(key, values[key])]));
    setErrors(next); setNotice(''); setSent(false);
    const first = Object.keys(next).find(key => next[key]);
    if (first) { document.getElementById(`enquiry-${first}`)?.focus(); return; }
    setBusy(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/public/enquiry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!response.ok) { setNotice(response.status === 429 ? c.rateError : c.error); return; }
      setNotice(c.success); setValues(empty); setErrors({}); setSent(true);
    } catch { setNotice(c.error); } finally { setBusy(false); }
  }

  return <section id="contact" className="vg-contact vg-section"><div className="vg-container vg-contact-grid"><Reveal><p className="vg-eyebrow">{c.contactLabel}</p><h2>{c.contactTitle}</h2><p>{c.contactIntro}</p>
    <address><a href={`tel:${c.phoneHref}`} data-testid="contact-phone">{c.phone}</a><a href={`mailto:${c.email}`} data-testid="contact-email">{c.email}</a>{c.address && <span>{c.address}</span>}{c.hours && <span>{c.hours}</span>}{c.whatsapp && <a href={`https://wa.me/${c.whatsapp}`} data-testid="contact-whatsapp">{c.whatsappLabel}</a>}<a href="https://www.google.com/maps/search/?api=1&query=Tiruppur%20Tamil%20Nadu" data-testid="contact-map">{c.directions}<ArrowUpRight size={17}/></a></address>
  </Reveal><form onSubmit={submit} noValidate className="vg-form" data-testid="enquiry-form"><p>{c.required}</p><div className="vg-form-grid">{['name','company','email','phone'].map((field, index) => <Reveal key={field} delay={index * stagger}><label htmlFor={`enquiry-${field}`}>{c.fields[field]}{['name','email'].includes(field) && ' *'}<input id={`enquiry-${field}`} name={field} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={values[field]} onChange={event => update(field,event.target.value)} onBlur={event => setErrors(previous => ({...previous,[field]:validate(field,event.target.value)}))} required={['name','email'].includes(field)} maxLength={limits[field]} autoComplete={{name:'name',company:'organization',email:'email',phone:'tel'}[field]} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${field}-error` : undefined} data-testid={`enquiry-${field}`}/>{errors[field] && <span className="vg-field-error" id={`${field}-error`}>{errors[field]}</span>}</label></Reveal>)}</div>
    <Reveal delay={4 * stagger}><label htmlFor="enquiry-message">{c.fields.message} *<textarea ref={messageRef} id="enquiry-message" name="message" value={values.message} onChange={event => update('message',event.target.value)} onBlur={event => setErrors(previous => ({...previous,message:validate('message',event.target.value)}))} required maxLength={limits.message} rows="5" aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'message-help message-error' : 'message-help'} data-testid="enquiry-message"/>{errors.message && <span className="vg-field-error" id="message-error">{errors.message}</span>}</label><small id="message-help">{c.messageHelp}</small></Reveal>
    <div className="vg-honeypot" aria-hidden="true"><label>{c.fields.website}<input name="website" value={values.website} onChange={event => update('website',event.target.value)} tabIndex="-1" autoComplete="off" maxLength="200" data-testid="enquiry-website"/></label></div>
    <button className="vg-button vg-button-blue vg-submit" type="submit" disabled={busy} data-testid="enquiry-submit">{busy && <span className="vg-spinner" aria-hidden="true"/>}{busy ? c.sending : c.submit}<ArrowRight size={18}/></button><small>{c.privacy}</small><p className="vg-status" role="status" aria-live="polite" data-testid="enquiry-status">{sent && <m.span initial={reduced ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Check aria-hidden="true"/></m.span>}{notice}</p>
  </form></div></section>;
}
