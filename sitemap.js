// Builds sitemap.xml with the home page and every live plan.
// Uses only the public (publishable) key, the same one the website uses.
const fs = require('fs');
const URL_ = 'https://cmtrtvpanfhrbpdztkvn.supabase.co';
const KEY = 'sb_publishable_UZAKaPQsCY6pEXo086lXOw_0FyRqEzE';
const SITE = 'https://planinparis.com/';

// Same rule as the website, so the links match exactly
const slugTx = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
const nombre = p => (p.i18n && p.i18n.en && p.i18n.en.nombre) || p.nombre;
const pslug = p => { const s = slugTx(nombre(p)); return p.id + (s ? '-' + s : ''); };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

(async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await fetch(`${URL_}/rest/v1/planes?select=id,nombre,i18n,creado_en&estado=eq.aprobado&or=(fecha_fin.gte.${hoy},fecha_fin.is.null)&order=id`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!r.ok) { console.error('Supabase error', r.status, await r.text()); process.exit(1); }
  const planes = await r.json();
  const urls = [`  <url><loc>${SITE}</loc><lastmod>${hoy}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`];
  for (const p of planes) {
    const mod = (p.creado_en || hoy).slice(0, 10);
    urls.push(`  <url><loc>${esc(SITE + '?plan=' + pslug(p))}</loc><lastmod>${mod}</lastmod></url>`);
  }
  fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  console.log('sitemap.xml with', urls.length, 'pages');
})();
