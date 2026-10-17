"""Vérifie la connexion obligatoire (requireLogin) et l'écran « compte refusé », avec une fausse configuration Firebase."""
import os, sys, tempfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _site import make_site, config_cloud

SHOTS = os.environ.get("REVI_SHOTS", os.path.join(tempfile.gettempdir(), "revi-shots")); os.makedirs(SHOTS, exist_ok=True)
URL, STOP = make_site(config_cloud(require_login=True))
problems, errs = [], []

def check(cond, msg):
    print(("ok: " if cond else "ÉCHEC: ") + msg)
    if not cond: problems.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, service_workers="block")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_timeout(2500)
    main = page.inner_text("main")
    check("Connectez-vous" in main and "Continuer avec Google" in main, "écran de connexion affiché à l'ouverture")
    check("Créer un compte" not in main, "pas de bouton « Créer un compte » quand la connexion est obligatoire")
    check(page.locator(".topbar a[href='#/settings']").count() == 0 and page.locator(".sync").count() == 0, "barre du haut réduite (pas de réglages ni de pastille)")
    page.screenshot(path=f"{SHOTS}/g-gate.png", full_page=True)
    for path in ["#/new", "#/settings", "#/import", "#/set/abc/learn"]:
        page.goto(URL + path); page.wait_for_timeout(400)
        check("Continuer avec Google" in page.inner_text("main") and page.locator(".card-row, .mode, .deck").count() == 0, f"{path} reste bloqué sans connexion")
    # Simulation d'un compte refusé par les règles Firestore
    page.evaluate("revi.store.set({ user: { uid: 'u1', email: 'inconnu@exemple.fr' }, accessDenied: true, ready: true })")
    page.wait_for_timeout(300)
    check("Ce compte n’a pas accès à Révi" in page.inner_text("main"), "écran « compte refusé » affiché")
    page.screenshot(path=f"{SHOTS}/g-denied.png", full_page=True)
    page.evaluate("revi.store.set({ user: null, accessDenied: false })")
    page.wait_for_timeout(300)
    check("Connectez-vous" in page.inner_text("main"), "retour à l'écran de connexion après déconnexion")
    # Hors ligne : message explicite
    ctx.set_offline(True); page.wait_for_timeout(300)
    page.evaluate("location.hash = '#/hors-ligne'"); page.wait_for_timeout(500)
    check("hors ligne" in page.inner_text("main").lower(), "message hors ligne sur l'écran de connexion")
    ctx.set_offline(False)
    check(not errs, "aucune erreur JavaScript" + ("" if not errs else ": " + " | ".join(errs[:3])))
    b.close()
STOP()
print("\n=== BILAN ===\n" + ("Tout est bon." if not problems else "\n".join(problems)))
sys.exit(1 if problems else 0)
