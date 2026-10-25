import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('framer-motion', () => ({ ...jest.requireActual('framer-motion'), useReducedMotion: jest.fn(() => false) }));
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));
import { content } from './content';
import LandingPage from './LandingPage';
import { useReducedMotion } from 'framer-motion';

const markup = () => renderToStaticMarkup(<LandingPage />);

test('one primary heading and no empty business-fact sections', () => {
  const page = new DOMParser().parseFromString(markup(), 'text/html');
  expect(page.querySelectorAll('h1')).toHaveLength(1);
  for (const key of ['stats','certifications','clients','markets','gallery','testimonials']) {
    expect(content[key]).toHaveLength(0);
    expect(page.querySelector(`[data-testid="optional-${key}"]`)).toBeNull();
  }
});

test('all images declare alt text and no unconfirmed address is shown', () => {
  const page = new DOMParser().parseFromString(markup(), 'text/html');
  expect([...page.querySelectorAll('img')].every(img => img.hasAttribute('alt'))).toBe(true);
  expect(content.address).toBe('');
  expect(page.querySelector('address')?.textContent).not.toContain('Sri Nagar');
});

test('public landing has no staff login link', () => {
  const page = new DOMParser().parseFromString(markup(), 'text/html');
  expect(page.querySelector('a[href="/login"]')).toBeNull();
  expect(page.body.textContent).not.toContain('Staff login');
});

test('hero stays simple and the statement band and image chips are absent', () => {
  const page = new DOMParser().parseFromString(markup(), 'text/html');
  expect(page.querySelector('.vg-statement')).toBeNull();
  expect(page.querySelector('[data-testid="hero-quote"]')).toBeNull();
  expect(page.querySelector('[data-testid="hero-call"]')).toBeNull();
  expect(page.querySelector('.vg-image-chip')).toBeNull();
  expect(page.querySelector('[data-testid="nav-quote"]')).not.toBeNull();
});

test('a confirmed optional section appears only when supplied', () => {
  content.certifications.push('Verified test certification');
  try {
    const page = new DOMParser().parseFromString(markup(), 'text/html');
    expect(page.querySelector('[data-testid="optional-certifications"]')).not.toBeNull();
  } finally {
    content.certifications.pop();
  }
});

test('landing colours are defined only in the token block', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, 'landing.css'), 'utf8');
  const rest = css.slice(css.indexOf('.vg-landing *'));
  expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});

test('reduced motion renders content without inline transforms', () => {
  useReducedMotion.mockReturnValue(true);
  try {
    const page = new DOMParser().parseFromString(markup(), 'text/html');
    expect(page.querySelector('h1')?.textContent).toContain('Thoughtfully made');
    expect(page.querySelectorAll('.vg-process-track li')).toHaveLength(5);
    expect([...page.querySelectorAll('[style]')].filter(element => element.getAttribute('style').includes('transform')).map(element => element.outerHTML.slice(0, 200))).toEqual([]);
  } finally {
    useReducedMotion.mockReturnValue(false);
  }
});
