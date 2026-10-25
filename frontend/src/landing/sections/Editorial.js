import { useRef } from 'react';
import { m, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { content as c } from '../content';
import { Image } from './Image';
import { Reveal, stagger } from '../motion';

export function About() {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const smallY = useTransform(scrollYProgress, [0, 1], [25, -25]);
  return <section id="about" className="vg-about vg-section" ref={ref}><div className="vg-container vg-about-grid">
    <Reveal><p className="vg-eyebrow">{c.aboutLabel}</p><h2>{c.aboutTitle}</h2>{c.about.map(text => <p key={text}>{text}</p>)}</Reveal>
    <div className="vg-about-art"><Reveal clip><Image name="womens-rail" alt="Illustrative plain garments on a rail" width={960} height={1200} sizes="(max-width: 800px) 100vw, 48vw" /></Reveal><m.div className="vg-about-small" style={reduced ? undefined : { y: smallY }}><Image name="detail-jersey" alt="Illustrative knit fabric detail" width={640} height={640} sizes="(max-width: 800px) 38vw, 16vw" /></m.div></div>
  </div>{c.stats.length > 0 && <div className="vg-container vg-stats">{c.stats.map((stat, i) => <article key={i}><strong>{stat.value}</strong><span>{stat.label}</span></article>)}</div>}</section>;
}

export function Collections({ onChoose }) {
  const secondary = ['mens-polo', 'womens-cardigan'];
  return <section id="collection" className="vg-collection vg-section"><div className="vg-container">
    <p className="vg-eyebrow">{c.collectionLabel}</p><h2>{c.collectionTitle}</h2>
    <div className="vg-product-grid">{c.products.map((product, index) => <Reveal clip className="vg-product" key={product.title} delay={index * stagger}>
      <div className="vg-product-media"><Image name={index === 0 ? 'mens-crew' : 'womens-tops'} alt={product.alt} width={960} height={1200} sizes="(max-width: 800px) 100vw, (max-width: 1120px) 46vw, 540px" /><Image name={secondary[index]} alt="" width={960} height={1200} sizes="(max-width: 800px) 100vw, (max-width: 1120px) 46vw, 540px" className="vg-product-hover" /></div>
      <div className="vg-product-copy"><div><h3>{product.title}</h3><p>{product.description}</p></div><button type="button" onClick={() => onChoose(product.title)} data-testid={`product-${index}`} aria-label={`${c.rangeAction}: ${product.title}`}><ArrowUpRight size={22}/><span>{c.rangeAction}</span></button></div>
    </Reveal>)}</div>
  </div></section>;
}
