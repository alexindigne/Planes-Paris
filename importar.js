const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_KEY;
const limpia = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const mapa = new Map();
  for (let off = 0; off < 300; off += 100) {
    const q = new URLSearchParams({
      limit: '100',
      offset: String(off),
      where: 'date_end >= now() AND price_type = "gratuit"',
      order_by: 'date_start'
    });
    const r = await fetch('https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records?' + q);
    if (!r.ok) throw new Error('OpenData ' + r.status + ': ' + await r.text());
    const { results } = await r.json();
    if (!results.length) break;
    if (off === 0) console.log('Ejemplo de registro:', JSON.stringify(results[0]).slice(0, 800));
    for (const e of results) {
      const nombre = limpia(e.title);
      if (!nombre || !e.id) continue;
      const lugar = [e.address_name, e.address_street, e.address_zipcode].filter(Boolean).join(', ') || 'París';
      mapa.set('odp-' + e.id, {
        fuente_id: 'odp-' + e.id,
        nombre,
        precio: 'Gratis',
        lugar: limpia(lugar),
        descripcion: limpia(e.lead_text || e.description).slice(0, 220),
        organizador: 'Que faire à Paris',
        fecha_inicio: e.date_start ? e.date_start.slice(0, 10) : null,
        fecha_fin: e.date_end ? e.date_end.slice(0, 10) : null,
        url_fuente: e.url || null,
        estado: 'pendiente'
      });
    }
  }
  const filas = [...mapa.values()];
  console.log('Planes encontrados:', filas.length);
  if (!filas.length) return;
  const s = await fetch(U + '/rest/v1/planes?on_conflict=fuente_id', {
    method: 'POST',
    headers: {
      apikey: K,
      Authorization: 'Bearer ' + K,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(filas)
  });
  if (!s.ok) throw new Error('Supabase ' + s.status + ': ' + await s.text());
  console.log('Guardado en Supabase OK');
}
main().catch(err => { console.error(err); process.exit(1); });
