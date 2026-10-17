"""Vérifie la logique de synchro avec le vrai SDK Firestore, côté appareil (serveur injoignable : on teste le cache local,
la fusion des patchs, increment() et deleteField(), et la survie des données après rechargement hors ligne)."""
from playwright.sync_api import sync_playwright
JS = """
async () => {
  const cloud = await import('/js/cloud.js');
  const util = await import('/js/util.js');
  if (!window.__inited) { cloud.initCloud({ apiKey: 'AIzaFake000000000000000000000000000', authDomain: 'x.firebaseapp.com', projectId: 'revi-local-test', appId: '1:1:web:1' }); window.__inited = true; }
  const be = new cloud.CloudBackend({ uid: 'u1' }, (e) => { window.__err = String(e); });
  const snaps = [];
  await new Promise((resolve) => { be.start((data, meta) => { snaps.push(JSON.parse(JSON.stringify({ data, meta }))); resolve(); }); setTimeout(resolve, 3000); });
  return { be: !!be, first: snaps[0] };
}
"""
WRITE = """
async () => {
  const cloud = await import('/js/cloud.js');
  const util = await import('/js/util.js');
  const be = new cloud.CloudBackend({ uid: 'u1' }, (e) => { window.__err = String(e); });
  let last = null;
  be.start((d, m) => { last = { d: JSON.parse(JSON.stringify(d)), m }; });
  await new Promise(r => setTimeout(r, 800));
  be.apply('sets', 's1', { title: 'A', cards: { c1: { term: 't1', definition: 'd1', order: 0 }, c2: { term: 't2', definition: 'd2', order: 1 } } });
  be.apply('sets', 's1', { cards: { c1: { starred: true }, c2: util.DELETE } });
  be.apply('progress', 's1', { cards: { c1: { ok: util.inc(1), lvl: 1 } } });
  be.apply('progress', 's1', { cards: { c1: { ok: util.inc(1), ko: util.inc(1) } } });
  await new Promise(r => setTimeout(r, 1200));
  be.stop();
  return { last, err: window.__err || null };
}
"""
READ = """
async () => {
  const cloud = await import('/js/cloud.js');
  if (!window.__inited) { cloud.initCloud({ apiKey: 'AIzaFake000000000000000000000000000', authDomain: 'x.firebaseapp.com', projectId: 'revi-local-test', appId: '1:1:web:1' }); window.__inited = true; }
  const be = new cloud.CloudBackend({ uid: 'u1' }, () => {});
  let last = null;
  be.start((d, m) => { last = { d: JSON.parse(JSON.stringify(d)), m }; });
  await new Promise(r => setTimeout(r, 2500));
  return last;
}
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(service_workers="block")
    page = ctx.new_page()
    page.goto("http://localhost:8080/#/"); page.wait_for_timeout(800)
    r0 = page.evaluate(JS)
    print("démarrage hors serveur :", r0["first"]["meta"] if r0["first"] else "aucun instantané")
    r = page.evaluate(WRITE)
    d = r["last"]["d"]
    s1 = d["sets"].get("s1", {}); p1 = d["progress"].get("s1", {})
    print("série fusionnée :", s1)
    print("progression :", p1)
    ok = (s1.get("title") == "A" and s1["cards"]["c1"].get("starred") is True and "c2" not in s1["cards"]
          and p1["cards"]["c1"]["ok"] == 2 and p1["cards"]["c1"]["ko"] == 1 and p1["cards"]["c1"]["lvl"] == 1)
    print("pending :", r["last"]["m"], "erreur :", r["err"])
    page.reload(); page.wait_for_timeout(800)
    r2 = page.evaluate(READ)
    print("après rechargement (cache IndexedDB) :", r2["d"]["sets"].get("s1", {}).get("title"), r2["d"]["progress"].get("s1"))
    ok = ok and r2["d"]["sets"].get("s1", {}).get("title") == "A"
    print("RÉSULTAT :", "OK" if ok else "ÉCHEC")
    b.close()
