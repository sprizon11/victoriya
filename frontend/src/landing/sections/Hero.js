import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight, Phone } from 'lucide-react';
import { content as c } from '../content';
import { Image } from './Image';
import { ease } from '../motion';

export function Hero() {
  const ref = useRef(null);
  const [frame, setFrame] = useState(0);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imageY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', '-14%']);
  const copyOpacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  const darkening = useTransform(scrollYProgress, [0, 1], [0.56, 0.76]);

  useEffect(() => {
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => {
    if (reduced || !visible || !tabVisible) return;
    const timer = window.setInterval(() => setFrame(index => (index + 1) % c.heroFrames.length), 6000);
    return () => window.clearInterval(timer);
  }, [reduced, visible, tabVisible]);

  return <section id="hero" className="vg-hero" ref={ref}>
    <m.div className="vg-hero-images" style={reduced ? undefined : { y: imageY }}>
      <AnimatePresence initial={false}>{c.heroFrames.map((item, index) => index === frame && <m.div className="vg-hero-frame" key={item.image} initial={reduced ? false : { opacity: 0, scale: 1 }} animate={reduced ? undefined : { opacity: 1, scale: 1.08 }} exit={reduced ? undefined : { opacity: 0 }} transition={{ opacity: { duration: 1.2 }, scale: { duration: 7, ease: 'linear' } }}>
        <Image name={item.image} alt={item.alt} width={2560} height={1440} sizes="100vw" eager={index === 0} hero />
      </m.div>)}</AnimatePresence>
    </m.div>
    <m.div className="vg-hero-shade" style={reduced ? undefined : { opacity: darkening }} />
    <div className="vg-hero-static-shade" />
    <m.div className="vg-container vg-hero-content" style={reduced ? undefined : { y: copyY, opacity: copyOpacity }}>
      <p className="vg-eyebrow">{c.eyebrow}</p>
      <h1>{c.headline.split('\n').map((line, index) => <span className="vg-headline-mask" key={line}><m.span initial={reduced ? false : { y: '110%' }} animate={reduced ? undefined : { y: '0%' }} transition={{ duration: 0.85, ease, delay: index * 0.12 }}>{line}</m.span></span>)}</h1>
      <m.p className="vg-hero-intro" initial={reduced ? false : { opacity: 0, y: 16 }} animate={reduced ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.5 }}>{c.intro}</m.p>
      <m.div className="vg-actions" initial={reduced ? false : { opacity: 0, y: 16 }} animate={reduced ? undefined : { opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.6 }}>
        <a className="vg-button vg-button-light" href="#contact" data-testid="hero-quote">{c.quote}<ArrowUpRight size={18}/></a>
        <a className="vg-button vg-button-outline" href={`tel:${c.phoneHref}`} data-testid="hero-call"><Phone size={18}/>{c.call}</a>
      </m.div>
    </m.div>
    <div className="vg-hero-bottom vg-container"><span className="vg-scroll-cue">{c.scrollCue}<span /></span><span className="vg-image-chip">{c.imageCaption}</span></div>
  </section>;
}
