import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));
import { content } from './content';
import LandingPage from './LandingPage';

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
