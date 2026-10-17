"""Vérifie que le mode synchronisé démarre sans erreur avec une configuration Firebase (serveurs injoignables ici)."""
import os, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _site import make_site, config_cloud
URL, STOP = make_site(config_cloud(require_login=False))
import os, tempfile
SHOTS = os.environ.get("REVI_SHOTS", os.path.join(tempfile.gettempdir(), "revi-shots")); os.makedirs(SHOTS, exist_ok=True)
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, service_workers="block")
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(f"{m.type}: {m.text[:200]}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.goto(URL + "#/settings"); page.wait_for_timeout(2500)
    txt = page.inner_text("main")
    print("formulaire de connexion :", "Continuer avec Google" in txt and "Se connecter" in txt)
    print("badge :", page.locator(".sync").inner_text())
    page.screenshot(path=f"{SHOTS}/c-settings-login.png", full_page=True)
    page.get_by_label("Email").fill("test@example.com"); page.get_by_label("Mot de passe").fill("secret123")
    page.get_by_role("button", name="Se connecter").click(); page.wait_for_timeout(4000)
    print("message après tentative :", page.locator("form p").inner_text())
    print("cloud chargé :", page.evaluate("!!window.revi && window.revi.store.state.cloudConfigured"))
    print("erreurs :", errs or "aucune")
    b.close()
STOP()
