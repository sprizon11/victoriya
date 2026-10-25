import React from 'react';

export function Image({ name, alt, width = 960, height = 1200, sizes = '100vw', className = '', eager = false, hero = false }) {
  const widths = hero ? [640, 960, 1280, 1920, 2560] : [640, 960, 1280, 1920];
  const srcSet = ext => widths.map(w => `/landing/${name}-${w}.${ext} ${w}w`).join(', ');
  return <picture className={className}>
    <source type="image/webp" srcSet={srcSet('webp')} sizes={sizes} />
    <img src={`/landing/${name}-${width <= 640 ? 640 : 960}.jpg`} srcSet={srcSet('jpg')} sizes={sizes}
      width={width} height={height} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async"
      fetchPriority={eager ? 'high' : undefined} />
  </picture>;
}
