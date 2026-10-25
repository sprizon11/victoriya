"""Public SEO routes must derive from each request and exclude portal paths."""
import os
import requests
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8000')
sitemap = requests.get(base+'/sitemap.xml', headers={'X-Forwarded-Proto':'https','X-Forwarded-Host':'example.test'}, timeout=10)
assert sitemap.status_code == 200
assert sitemap.text.count('<loc>') == 1
assert '<loc>https://example.test/home</loc>' in sitemap.text
robots = requests.get(base+'/robots.txt', headers={'X-Forwarded-Proto':'https','X-Forwarded-Host':'example.test'}, timeout=10)
assert robots.status_code == 200
assert 'Sitemap: https://example.test/sitemap.xml' in robots.text
for path in ['login','api/','lots','production','weeks','approvals','stock','purchase-orders','salary','advances','payroll','vouchers','expenses','reports','operators','operations','colors','size-charts','rate-types','users','enquiries','audit','settings','year-end']:
    assert f'Disallow: /{path}\n' in robots.text, path
assert 'Allow: /home' in robots.text
assert requests.get(base+'/sitemap.xml',headers={'X-Forwarded-Host':'bad<>host'}).status_code == 400
print('Public sitemap and robots checks passed')
