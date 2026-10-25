import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { content as c } from '../content';
import { Image } from './Image';
import { Reveal, stagger } from '../motion';

function ReelItem({ item, index, progress }) {
  const reduced = useReducedMotion();
  const x = useTransform(progress, [0, 1], ['0px', `${(index % 3 - 1) * 42}px`]);
  return <m.figure className={`vg-reel-item vg-${item.ratio}`} style={reduced ? undefined : { x }}><Image name={item.image} alt={item.alt} width={item.ratio === 'portrait' ? 960 : 1280} height={item.ratio === 'portrait' ? 1200 : item.ratio === 'square' ? 1280 : 840} sizes="(max-width: 600px) 75vw, 30vw" /></m.figure>;
}

export function Reel() {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const x = useTransform(scrollYProgress, [0, 1], ['0%', '-22%']);
  return <section className="vg-reel vg-section" ref={ref}><div className="vg-container"><p className="vg-eyebrow">{c.reelLabel}</p><h2>{c.reelTitle}</h2><p className="vg-image-note">{c.imageNote}</p></div>
    <m.div className="vg-reel-track" style={reduced ? undefined : { x }}>{c.reel.map((item, index) => <ReelItem item={item} index={index} progress={scrollYProgress} key={item.image} />)}</m.div>
  </section>;
}

export function Process() {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const x = useTransform(scrollYProgress, [0, 1], ['0%', '-80%']);
  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);
  useEffect(() => scrollYProgress.on('change', value => setActive(Math.min(4, Math.floor(value * 5)))), [scrollYProgress]);
  return <section id="process" className="vg-process" ref={ref}><div className="vg-process-pin"><div className="vg-container vg-process-heading"><p className="vg-eyebrow">{c.processLabel}</p><h2>{c.processTitle}</h2><p>{c.processIntro}</p></div>
    <div className="vg-process-viewport"><m.ol className="vg-process-track" style={reduced ? undefined : { x }}>{c.steps.map((step, index) => <li key={step.image} className={active === index ? 'vg-step-active' : ''}>
      <div className="vg-process-media"><Image name={`process-${step.image}-v3`} alt={step.alt} width={1280} height={960} sizes="(max-width: 800px) 100vw, 65vw" /></div>
      <div className="vg-step-copy"><span>{String(index + 1).padStart(2, '0')} / 05</span><h3>{step.title}</h3><p>{step.detail}</p></div>
    </li>)}</m.ol></div>
    <div className="vg-process-progress vg-container"><m.div className="vg-stitch" style={reduced ? undefined : { scaleX: pathLength }} /><div>{c.steps.map((step, index) => <span className={active === index ? 'vg-current' : ''} key={step.image}>{String(index + 1).padStart(2, '0')}</span>)}</div></div>
  </div></section>;
}

export function Gallery() {
  const items = c.gallery.length ? c.gallery : c.illustrativeGallery;
  const [selected, setSelected] = useState(null);
  const closeRef = useRef(null);
  const returnRef = useRef(null);
  const reduced = useReducedMotion();
  const dialogOpen = selected !== null;
  useEffect(() => {
    if (!dialogOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function keydown(event) {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'ArrowRight') setSelected(index => (index + 1) % items.length);
      if (event.key === 'ArrowLeft') setSelected(index => (index + items.length - 1) % items.length);
      if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll('.vg-lightbox button')];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', keydown); returnRef.current?.focus(); };
  }, [dialogOpen, items]);
  return <section id="gallery" className="vg-gallery vg-section"><div className="vg-container"><p className="vg-eyebrow">{c.galleryLabel}</p><h2>{c.galleryTitle}</h2><p className="vg-image-note">{c.imageNote}</p>
    <div className="vg-gallery-grid">{items.map((item, index) => <Reveal className={`vg-gallery-cell vg-gallery-cell-${index}`} key={item.image || item.src} delay={(index % 4) * stagger} clip><button type="button" onClick={event => { returnRef.current = event.currentTarget; setSelected(index); }} data-testid={`gallery-${index}`} aria-label={`${c.galleryOpen}: ${item.alt}`}>
      {item.image ? <Image name={item.image} alt={item.alt} width={item.ratio === 'portrait' ? 960 : 1280} height={item.ratio === 'portrait' ? 1200 : 1280} sizes="(max-width: 600px) 50vw, 28vw" /> : <img src={item.src} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" />}<span>{c.galleryOpen}</span>
    </button></Reveal>)}</div></div>
    <AnimatePresence>{selected !== null && <m.div className="vg-lightbox" role="dialog" aria-modal="true" aria-label={c.galleryTitle} data-testid="gallery-lightbox" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduced ? {} : { opacity: 0 }}>
      <button ref={closeRef} className="vg-lightbox-close" type="button" onClick={() => setSelected(null)} aria-label={c.galleryClose} data-testid="lightbox-close"><X/></button>
      <button type="button" onClick={() => setSelected((selected + items.length - 1) % items.length)} aria-label={c.galleryPrevious} data-testid="lightbox-previous"><ArrowLeft/></button>
      <figure>{items[selected].image ? <Image name={items[selected].image} alt={items[selected].alt} width={1280} height={1280} sizes="85vw" /> : <img src={items[selected].src} alt={items[selected].alt} width={items[selected].width} height={items[selected].height}/>}</figure>
      <button type="button" onClick={() => setSelected((selected + 1) % items.length)} aria-label={c.galleryNext} data-testid="lightbox-next"><ArrowRight/></button>
    </m.div>}</AnimatePresence>
  </section>;
}

export function HowToStart() {
  return <section className="vg-start vg-section"><div className="vg-container"><p className="vg-eyebrow">{c.startLabel}</p><h2>{c.startTitle}</h2><ol className="vg-start-grid">{c.startSteps.map((step, index) => <li key={step.title}><Reveal delay={index * stagger}><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3><p>{step.detail}</p></Reveal></li>)}</ol></div></section>;
}
