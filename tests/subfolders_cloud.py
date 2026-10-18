"""Sous-dossiers avec le vrai SDK Firestore (serveur injoignable : cache local seulement).
Avec Firestore, les écritures n'arrivent dans store.state qu'au prochain instantané : on vérifie que créer, ranger,
renommer, déplacer et supprimer des dossiers donne le bon résultat, y compris quand plusieurs opérations s'enchaînent sans attendre."""
import os, sys, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _site import make_site, CONFIG_LOCAL
URL, STOP = make_site(CONFIG_LOCAL)
problems = []

def check(cond, msg):
    print(("ok: " if cond else "ÉCHEC: ") + msg)
    if not cond: problems.append(msg)

JS = """
async () => {
  const cloud = await import('/js/cloud.js');
  const { store } = await import('/js/store.js');
  cloud.initCloud({ apiKey: 'AIzaFake000000000000000000000000000', authDomain: 'x.firebaseapp.com', projectId: 'revi-sub-test', appId: '1:1:web:1' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  store.useBackend(new cloud.CloudBackend({ uid: 'u-sub' }, (e) => { window.__err = String(e); }), { ready: false });
  for (let i = 0; i < 40 && !store.state.ready; i++) await wait(100);
  const snap = () => ({
    folders: Object.values(store.state.folders).map((f) => f.name).sort(),
    sets: Object.fromEntries(Object.values(store.state.sets).map((s) => [s.title, s.folder])),
  });
  const out = {};
  // 1. Création d'un chemin à 3 niveaux : un document par niveau
  store.createFolder('Langues / Allemand / Bases');
  await wait(400); out.created = snap();
  // 2. Séries dans des sous-dossiers, dont un sous-dossier qui n'existe pas encore
  store.createSet({ title: 'Mots', folder: 'langues/allemand/bases', cards: [{ term: 'chien', definition: 'Hund' }] });
  store.createSet({ title: 'Verbes forts', folder: 'Langues/Allemand/Verbes', cards: [{ term: 'aller', definition: 'gehen' }] });
  store.createFolder('Anglais'); store.createFolder('Espagnol');
  await wait(400); out.sets = snap();
  // 3. Ranger deux dossiers d'un coup dans Langues (sans attendre entre les deux déplacements)
  const r = store.moveFoldersInto(['Anglais', 'Espagnol'], 'Langues');
  await wait(400); out.arranged = { ...snap(), r };
  // 4. Renommer le parent : tout le contenu suit
  store.renameFolder('Langues', 'Langues vivantes');
  await wait(400); out.renamed = snap();
  // 5. Déplacer Allemand sur l'accueil
  store.moveFolder('Langues vivantes/Allemand', 'Allemand');
  await wait(400); out.moved = snap();
  // 6. Supprimer Allemand : Bases et Verbes remontent sur l'accueil, avec leurs séries
  store.deleteFolder('Allemand');
  await wait(400); out.deleted = { ...snap(), roots: store.subfolders('').map((f) => f.label) };
  out.err = window.__err || null;
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(service_workers="block")
    page = ctx.new_page()
    page.goto(URL + "#/"); page.wait_for_timeout(800)
    o = page.evaluate(JS)
    print(json.dumps(o, ensure_ascii=False, indent=1))
    check(o["created"]["folders"] == ["Langues", "Langues/Allemand", "Langues/Allemand/Bases"], "un document par niveau à la création")
    check(o["sets"]["sets"] == {"Mots": "Langues/Allemand/Bases", "Verbes forts": "Langues/Allemand/Verbes"}, "séries rangées avec la casse des dossiers existants")
    check("Langues/Allemand/Verbes" in o["sets"]["folders"], "sous-dossier créé à l'enregistrement de la série")
    check(o["arranged"]["r"]["moved"] == 2 and {"Langues/Anglais", "Langues/Espagnol"} <= set(o["arranged"]["folders"]) and "Anglais" not in o["arranged"]["folders"], "deux dossiers rangés d'un coup")
    check(all(f.startswith("Langues vivantes") for f in o["renamed"]["folders"]) and o["renamed"]["sets"]["Mots"] == "Langues vivantes/Allemand/Bases", "renommer le parent met tout à jour")
    check(o["moved"]["sets"] == {"Mots": "Allemand/Bases", "Verbes forts": "Allemand/Verbes"} and "Allemand" in o["moved"]["folders"], "déplacer un dossier emporte ses séries")
    check(o["deleted"]["sets"] == {"Mots": "Bases", "Verbes forts": "Verbes"} and o["deleted"]["roots"] == ["Bases", "Langues vivantes", "Verbes"], "supprimer un dossier fait remonter son contenu")
    check(not o["err"], "aucune erreur Firestore")
    b.close()
STOP()
print("\n=== BILAN ===")
print("Tout est bon." if not problems else "\n".join(problems))
sys.exit(1 if problems else 0)
