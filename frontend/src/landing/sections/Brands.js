import { ArrowUpRight } from 'lucide-react';
import { content as c } from '../content';
import { Image } from './Image';
import { Reveal, stagger } from '../motion';

// Each brand's logo is shown on its own brand colour, exactly as supplied. Never recolour or crop them.
export function Brands({ onChoose }) {
  return <section id="brands" className="vg-brands vg-section" aria-labelledby="brands-title"><div className="vg-container">
    <div className="vg-brands-head"><Reveal><p className="vg-eyebrow">{c.brandsLabel}</p><h2 id="brands-title">{c.brandsTitle}</h2></Reveal>
      <Reveal delay={stagger}><p>{c.brandsIntro}</p></Reveal></div>
    <ul className="vg-brand-grid">{c.brands.map((brand, index) => <li key={brand.name}><Reveal delay={index * stagger}>
      <article className="vg-brand" data-testid={`brand-${brand.image}`}>
        <div className="vg-brand-media"><Image name={brand.image} alt={brand.alt} width={960} height={384} sizes="(max-width: 900px) 100vw, 46vw" /></div>
        <div className="vg-brand-copy"><div><h3>{brand.name}</h3><p>{brand.tagline}</p></div>
          <button type="button" className="vg-brand-link" onClick={() => onChoose(brand.name)} data-testid={`brand-ask-${brand.image}`}>{c.brandAction}<ArrowUpRight size={17} aria-hidden="true" /></button></div>
      </article></Reveal></li>)}</ul>
  </div></section>;
}
