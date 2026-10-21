// Copies every plan's photo into our own storage (Supabase Storage, bucket "fotos"),
// resized for phones and converted to WebP. The app then loads fast and photos never break.
// Runs on its own (fotos.yml): it doesn't change how the other robots find plans or photos.
const crypto = require('crypto');
const sharp = require('sharp');

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'fotos';
const ANCHO = 1080;          // px: sharp on any phone, small file
const CALIDAD = 76;          // WebP quality
const MAX_POR_VEZ = 400;     // photos copied per run
const UA = 'Mozilla/5.0 (compatible; Planinparis/1.0; +https://planinparis.com/)';
const PUBLICA = `${U}/storage/v1/object/public/${BUCKET}/`;
const nuestra = u => String(u || '').startsWith(PUBLICA);

async function sb(path, opts = {}) {
  const r = await fetch(U + '/rest/v1/' + path, { ...opts, headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + await r.text());
  return r;
}
async function bajar(url) {
  let origen = ''; try { origen = new URL(url).origin + '/'; } catch (_) {}
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', Referer: origen }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 3000) throw new Error('too small');
  return buf;
}
async function subir(nombre, buf) {
  const r = await fetch(`${U}/storage/v1/object/${BUCKET}/${nombre}`, {
    method: 'POST',
    headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
    body: buf
  });
  if (!r.ok) throw new Error('Storage ' + r.status + ': ' + (await r.text()).slice(0, 150));
}
async function enParalelo(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

async function copiar() {
  const planes = await (await sb(`planes?select=id,foto,foto_original&foto=not.is.null&order=id.desc&limit=5000`)).json();
  const pendientes = planes.filter(p => !nuestra(p.foto)).slice(0, MAX_POR_VEZ);
  let ok = 0, mal = 0, ahorro = 0;
  const fallos = {};
  await enParalelo(pendientes, 4, async p => {
    try {
      const orig = await bajar(p.foto);
      const webp = await sharp(orig, { failOn: 'none' }).rotate().resize({ width: ANCHO, withoutEnlargement: true }).webp({ quality: CALIDAD }).toBuffer();
      // the name changes when the photo changes, so phones never show an old cached one
      const nombre = `${p.id}-${crypto.createHash('sha1').update(p.foto).digest('hex').slice(0, 10)}.webp`;
      await subir(nombre, webp);
      await sb(`planes?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ foto: PUBLICA + nombre, foto_original: p.foto }) });
      ok++; ahorro += orig.length - webp.length;
    } catch (err) {
      mal++; const m = String(err.message).slice(0, 40); fallos[m] = (fallos[m] || 0) + 1;
    }
  });
  console.log(`Photos copied: ${ok} | failed (kept the original link, retried next run): ${mal} | still to copy: ${Math.max(0, planes.filter(p => !nuestra(p.foto)).length - ok)}`);
  if (mal) console.log('Why some failed:', JSON.stringify(fallos));
  console.log(`Weight saved: ${(ahorro / 1e6).toFixed(1)} MB`);
}

// Files no plan uses any more (photo replaced, plan deleted) are removed to keep storage small
async function limpiar() {
  const usadas = new Set((await (await sb(`planes?select=foto&foto=like.${encodeURIComponent(PUBLICA)}*&limit=10000`)).json()).map(p => p.foto.slice(PUBLICA.length)));
  const sobran = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${U}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1000, offset: off }) });
    if (!r.ok) throw new Error('Storage list ' + r.status);
    const lista = await r.json();
    for (const f of lista) if (f.name && f.id && !usadas.has(f.name)) sobran.push(f.name);
    if (lista.length < 1000) break;
  }
  // safety: never delete everything because of a failed read
  if (!usadas.size || sobran.length > 300) { console.log(`Cleanup skipped (${sobran.length} unused files)`); return; }
  for (let i = 0; i < sobran.length; i += 100) {
    await fetch(`${U}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: sobran.slice(i, i + 100) }) });
  }
  console.log(`Unused photos deleted: ${sobran.length}`);
}

(async () => {
  if (!U || !K) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
  await copiar();
  try { await limpiar(); } catch (err) { console.error('Cleanup failed:', err.message); }
})();
