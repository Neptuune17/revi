"""Test de bout en bout de Révi (mode local) : chaque mode est joué comme un utilisateur, sur mobile puis ordinateur.
Lancement : python3 tests/e2e.py (le script sert lui-même une copie de l'appli)."""
import sys, re, json
from playwright.sync_api import sync_playwright, expect

import os, tempfile
SHOTS = os.environ.get("REVI_SHOTS", os.path.join(tempfile.gettempdir(), "revi-shots")); os.makedirs(SHOTS, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _site import make_site, CONFIG_LOCAL
URL, STOP_SITE = make_site(CONFIG_LOCAL)  # appli en mode local (sans Firebase)
problems = []

def check(cond, msg):
    if not cond:
        problems.append(msg); print("ÉCHEC:", msg)
    else:
        print("ok:", msg)

def cards_of(page, sid):
    return page.evaluate("""(sid) => window.revi.store.cardsOf(window.revi.store.getSet(sid))""", sid)

def answer_for(cards, prompt):
    for c in cards:
        if c["term"].strip() == prompt.strip(): return c["definition"]
        if c["definition"].strip() == prompt.strip(): return c["term"]
    return None

def run(p, label, viewport, mobile, dark=False):
    errors = []
    b = p.chromium.launch()
    ctx = b.new_context(viewport=viewport, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile,
                        locale="fr-FR", color_scheme="dark" if dark else "light")
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    shot = lambda name: page.screenshot(path=f"{SHOTS}/{label}-{name}.png", full_page=True)

    page.goto(URL); page.wait_for_timeout(600)
    page.get_by_text("Ajouter la série d’exemple").click(); page.wait_for_timeout(300)
    sid = page.evaluate("location.hash").split("/")[2]
    cards = cards_of(page, sid)
    check(len(cards) == 14, f"[{label}] série d'exemple créée avec 14 cartes")

    # ---------- Cartes ----------
    page.goto(URL + f"#/set/{sid}/cards"); page.wait_for_timeout(400)
    shot("10-cards-front")
    page.locator(".flip").click(); page.wait_for_timeout(600)
    check("flipped" in (page.locator(".flip").get_attribute("class") or ""), f"[{label}] la carte se retourne au clic")
    shot("11-cards-back")
    for i in range(14):
        btn = page.get_by_role("button", name="Je sais" if i % 3 else "À revoir")
        btn.click(); page.wait_for_timeout(230)
    page.wait_for_timeout(300)
    check(page.get_by_text("Paquet terminé").count() == 1, f"[{label}] fin du paquet en mode tri")
    shot("12-cards-end")
    page.get_by_role("button", name=re.compile("Revoir les")).click(); page.wait_for_timeout(300)
    check(page.locator(".tally").inner_text().find("1 / 5") >= 0, f"[{label}] « Revoir les cartes » relance avec les 5 cartes à revoir")

    # ---------- Apprendre ----------
    page.goto(URL + f"#/set/{sid}/learn"); page.wait_for_timeout(400)
    shot("20-learn-mcq")
    wrong_done = written_wrong_done = typo_done = False
    shots_taken = set()
    for step in range(200):
        if page.get_by_text("Tout est maîtrisé").count():
            break
        if page.get_by_role("button", name="Manche suivante").count():
            if "round" not in shots_taken: shot("24-learn-round-end"); shots_taken.add("round")
            page.get_by_role("button", name="Manche suivante").click(); page.wait_for_timeout(250); continue
        prompt = page.locator(".qcard .prompt").inner_text()
        ans = answer_for(cards, prompt)
        if page.locator(".choice").count():
            choices = page.locator(".choice .txt").all_inner_texts()
            if not wrong_done:
                idx = next(i for i, c in enumerate(choices) if c.strip() != ans.strip())
                page.locator(".choice").nth(idx).click(); page.wait_for_timeout(200)
                shot("21-learn-mcq-wrong"); wrong_done = True
                page.get_by_role("button", name="Continuer").click(); page.wait_for_timeout(200); continue
            idx = next(i for i, c in enumerate(choices) if c.strip() == ans.strip())
            page.keyboard.press(str(idx + 1)); page.wait_for_timeout(1050)
        else:
            inp = page.locator(".answer-row input")
            if not written_wrong_done:
                inp.fill("n'importe quoi"); inp.press("Enter"); page.wait_for_timeout(200)
                shot("22-learn-written-wrong"); written_wrong_done = True
                page.get_by_role("button", name="Continuer").click(); page.wait_for_timeout(200); continue
            if not typo_done and len(ans) > 8:
                k = next(i for i in range(len(ans) // 2, len(ans)) if ans[i].isalpha())
                typed = ans[:k] + ans[k + 1:]  # une lettre oubliée au milieu
                inp.fill(typed); inp.press("Enter"); page.wait_for_timeout(200)
                shot("23-learn-typo"); typo_done = True
                check(page.locator(".feedback.ok").count() == 1, f"[{label}] une petite faute est acceptée ({typed!r})")
                if page.get_by_role("button", name="Continuer").count():
                    page.get_by_role("button", name="Continuer").click()
                page.wait_for_timeout(1200); continue
            inp.fill(ans); inp.press("Enter"); page.wait_for_timeout(1250)
    check(page.get_by_text("Tout est maîtrisé").count() == 1, f"[{label}] Apprendre jusqu'à maîtriser toute la série ({step} étapes)")
    shot("25-learn-done")
    mastered = page.evaluate("(sid) => window.revi.store.cardsOf(window.revi.store.getSet(sid)).filter(c => window.revi.store.statusOf(sid, c.id) === 2).length", sid)
    check(mastered == 14, f"[{label}] progression enregistrée : {mastered}/14 maîtrisées")

    # ---------- Test ----------
    page.goto(URL + f"#/set/{sid}/test"); page.wait_for_timeout(300)
    page.locator("input[type=number]").fill("12")
    shot("30-test-config")
    page.get_by_role("button", name="Commencer le test").click(); page.wait_for_timeout(300)
    blocks = page.locator(".tq")
    n = blocks.count()
    check(n == 12, f"[{label}] le test contient 12 questions")
    types = []
    for i in range(n):
        blk = blocks.nth(i)
        kind = blk.locator(".num span").nth(1).inner_text()
        types.append(kind)
        prompt = blk.locator("div > div").nth(1).inner_text()
        ans = answer_for(cards, prompt)
        good = i % 4 != 0
        if kind == "Vrai ou faux":
            claim = blk.locator(".tf-claim").inner_text().split("\n")[-1]
            truth = claim.strip() == ans.strip()
            blk.get_by_role("button", name="Vrai" if (truth == good) else "Faux").click()
        elif kind == "QCM":
            opts = blk.locator(".choice .txt").all_inner_texts()
            idx = next(j for j, o in enumerate(opts) if (o.strip() == ans.strip()) == good)
            blk.locator(".choice").nth(idx).click()
        else:
            blk.locator("input").fill(ans if good else "réponse fausse")
        page.wait_for_timeout(60)
    check(set(types) == {"Vrai ou faux", "QCM", "Réponse écrite"}, f"[{label}] les 3 types de questions sont présents")
    page.wait_for_timeout(400)
    shot("31-test-exam")
    page.get_by_role("button", name="Valider le test").click(); page.wait_for_timeout(500)
    score = page.locator(".score span").inner_text()
    check(score == "9/12", f"[{label}] note du test correcte ({score}, attendu 9/12)")
    shot("32-test-results")
    if page.get_by_role("button", name="En fait, j’avais juste").count():
        page.get_by_role("button", name="En fait, j’avais juste").first.click(); page.wait_for_timeout(300)
        check(page.locator(".score span").inner_text() == "10/12", f"[{label}] « J'avais juste » corrige la note")

    # ---------- Associer ----------
    page.goto(URL + f"#/set/{sid}/match"); page.wait_for_timeout(300)
    shot("40-match-start")
    for rnd in range(2):
        page.get_by_role("button", name=re.compile("Commencer|Rejouer")).click(); page.wait_for_timeout(300)
        if rnd == 0: shot("41-match-grid")
        made_error = rnd == 1
        for _ in range(30):
            tiles = page.locator(".tile:not(.gone):not(.good)")
            if tiles.count() == 0: break
            texts = tiles.all_inner_texts()
            first = texts[0]; target = answer_for(cards, first)
            if made_error:
                wrong = next(j for j, t in enumerate(texts) if j > 0 and t.strip() != target.strip() and answer_for(cards, t) is not None and t not in [c["term"] for c in cards if c["term"] == first])
                tiles.nth(0).click(); tiles.nth(wrong).click(); page.wait_for_timeout(450); made_error = False
                shot("42-match-error"); continue
            j = next(k for k, t in enumerate(texts) if k > 0 and t.strip() == target.strip())
            tiles.nth(0).click(); tiles.nth(j).click(); page.wait_for_timeout(260)
        page.wait_for_timeout(500)
        check(page.locator(".result-time").count() == 1, f"[{label}] partie d'Associer terminée (manche {rnd + 1})")
        if rnd == 0: shot("43-match-result")
    shot("44-match-result2")
    best = page.evaluate("(sid) => window.revi.store.progressOf(sid).best", sid)
    check(best and best.get("match", 0) > 0, f"[{label}] record enregistré : {best}")

    # ---------- Page série (stats) ----------
    page.goto(URL + f"#/set/{sid}"); page.wait_for_timeout(400)
    shot("50-set-stats")
    hist = page.locator(".history li").count()
    check(hist >= 5, f"[{label}] historique des sessions affiché ({hist} lignes)")
    page.locator(".sheet-row .icon-btn[aria-label='Ajouter une étoile']").first.click(); page.wait_for_timeout(200)
    check(page.get_by_role("button", name=re.compile("Étoilées")).count() == 1, f"[{label}] étoile ajoutée et filtre proposé")

    # ---------- Éditeur + import ----------
    page.goto(URL + "#/import"); page.wait_for_timeout(300)
    page.locator("details.import textarea").fill("chien\tdog\nchat\tcat\noiseau\tbird\n")
    page.wait_for_timeout(150)
    check("3 cartes détectées" in page.locator(".preview").inner_text(), f"[{label}] import : 3 cartes détectées (tabulations)")
    page.locator("details.import textarea").fill("chien - dog\nchat - cat")
    page.wait_for_timeout(150)
    check("2 cartes détectées" in page.locator(".preview").inner_text(), f"[{label}] import : séparateur « - » détecté")
    shot("60-import")
    page.get_by_role("button", name="Ajouter 2 cartes").click(); page.wait_for_timeout(200)
    page.get_by_placeholder("Ex. : Connecteurs logiques").fill("Animaux")
    page.get_by_placeholder("Aucun (ex. : Anglais)").fill("anglais")  # casse différente : doit rejoindre le dossier « Anglais »
    shot("61-editor")
    page.get_by_role("button", name="Enregistrer").click(); page.wait_for_timeout(400)
    check(page.locator("h1").inner_text() == "Animaux", f"[{label}] nouvelle série enregistrée")
    check(page.locator("a.chip").inner_text().strip() == "Anglais", f"[{label}] le nom du dossier est harmonisé (Anglais)")
    page.goto(URL + "#/"); page.wait_for_timeout(300)
    shot("62-home-two-sets")
    tile = page.locator(".folder-tile")
    check(tile.count() == 1 and "2 séries" in tile.first.inner_text() and page.locator(".deck").count() == 0, f"[{label}] accueil : un bouton de dossier « Anglais » avec 2 séries")

    # ---------- Dossiers ----------
    page.get_by_role("button", name="Nouveau dossier").click(); page.wait_for_timeout(200)
    page.locator("dialog input").fill("anglais"); page.get_by_role("button", name="Créer le dossier").click(); page.wait_for_timeout(200)
    check("existe déjà" in page.locator("dialog").inner_text() or "porte déjà" in page.locator("dialog").inner_text(), f"[{label}] un nom de dossier en double est refusé")
    page.locator("dialog input").fill("Histoire"); page.get_by_role("button", name="Créer le dossier").click(); page.wait_for_timeout(400)
    check(page.evaluate("location.hash") == "#/folder/Histoire" and "Rien dans ce dossier" in page.inner_text("main"), f"[{label}] dossier vide créé et ouvert")
    shot("80-folder-empty")
    page.get_by_role("button", name="Ajouter des séries existantes").click(); page.wait_for_timeout(200)
    shot("81-folder-pick")
    page.locator("dialog label.check", has_text="Animaux").click()
    page.locator("dialog").get_by_role("button", name="Ajouter (1)").click(); page.wait_for_timeout(400)
    check(page.locator(".deck h3").all_inner_texts() == ["Animaux"], f"[{label}] série existante rangée dans le dossier")
    page.get_by_role("link", name="Nouvelle série").click(); page.wait_for_timeout(300)
    check(page.get_by_placeholder("Aucun (ex. : Anglais)").input_value() == "Histoire", f"[{label}] nouvelle série pré-rangée dans le dossier")
    page.get_by_placeholder("Ex. : Connecteurs logiques").fill("Dates")
    rows = page.locator(".card-row textarea")
    rows.nth(0).fill("1789"); rows.nth(1).fill("Révolution française")
    page.get_by_role("button", name="Enregistrer").click(); page.wait_for_timeout(400)
    page.locator("a.chip").click(); page.wait_for_timeout(400)
    check(sorted(page.locator(".deck h3").all_inner_texts()) == ["Animaux", "Dates"], f"[{label}] la puce du dossier ramène au dossier (2 séries)")
    shot("82-folder-two")
    page.locator(".page-head .menu-wrap .icon-btn").click(); page.get_by_role("menuitem", name="Renommer le dossier").click(); page.wait_for_timeout(200)
    page.locator("dialog input").fill("Histoire-géo"); page.get_by_role("button", name="Renommer").click(); page.wait_for_timeout(400)
    sets_folders = page.evaluate("Object.values(revi.store.state.sets).map(s => s.folder).sort()")
    check(page.locator("h1").inner_text() == "Histoire-géo" and sets_folders.count("Histoire-géo") == 2, f"[{label}] dossier renommé, séries suivies ({sets_folders})")
    page.goto(URL + "#/"); page.wait_for_timeout(300)
    shot("83-home-folders")
    check(page.locator(".folder-tile").count() == 2, f"[{label}] accueil : 2 boutons de dossier")
    page.locator(".folder-tile", has_text="Histoire-géo").click(); page.wait_for_timeout(300)
    page.locator(".page-head .menu-wrap .icon-btn").click(); page.get_by_role("menuitem", name="Supprimer le dossier").click(); page.wait_for_timeout(200)
    page.locator("dialog").get_by_role("button", name="Supprimer le dossier").click(); page.wait_for_timeout(400)
    check(page.evaluate("location.hash") in ("#/", "") and "Séries sans dossier" in page.inner_text("main") and page.locator(".deck").count() == 2, f"[{label}] dossier supprimé, ses 2 séries reviennent sur l'accueil")
    page.get_by_role("button", name="Nouveau dossier").click(); page.locator("dialog input").fill("Physique"); page.get_by_role("button", name="Créer le dossier").click(); page.wait_for_timeout(300)
    page.reload(); page.wait_for_timeout(600); page.goto(URL + "#/"); page.wait_for_timeout(400)
    check(page.locator(".folder-tile", has_text="Physique").count() == 1 and "Dossier vide" in page.locator(".folder-tile", has_text="Physique").inner_text(), f"[{label}] un dossier vide est conservé après rechargement")
    shot("84-home-final")

    # ---------- Réglages ----------
    page.goto(URL + "#/settings"); page.wait_for_timeout(300)
    shot("70-settings")
    check("Synchronisation non configurée" in page.inner_text("main"), f"[{label}] réglages : état de la synchro affiché")

    # ---------- Persistance après rechargement ----------
    page.reload(); page.wait_for_timeout(600)
    n_sets = page.evaluate("Object.keys(window.revi.store.state.sets).length")
    check(n_sets == 3, f"[{label}] les données survivent au rechargement ({n_sets} séries)")

    # ---------- Service worker / hors ligne ----------
    page.goto(URL); page.wait_for_timeout(1500)
    sw = page.evaluate("navigator.serviceWorker.controller ? 'actif' : 'inactif'")
    if sw == "inactif":
        page.reload(); page.wait_for_timeout(1200)
        sw = page.evaluate("navigator.serviceWorker.controller ? 'actif' : 'inactif'")
    check(sw == "actif", f"[{label}] service worker actif")
    ctx.set_offline(True)
    page.reload(); page.wait_for_timeout(1000)
    check(page.locator(".deck").count() == 2 and page.locator(".folder-tile").count() == 2, f"[{label}] l'appli s'ouvre hors ligne avec les dossiers et les séries")
    page.goto(URL + f"#/set/{sid}/match"); page.wait_for_timeout(400)
    check(page.get_by_role("button", name="Commencer").count() == 1, f"[{label}] un mode d'étude marche hors ligne")
    ctx.set_offline(False)

    check(not errors, f"[{label}] aucune erreur JavaScript" + ("" if not errors else ": " + " | ".join(errors[:5])))
    b.close()

with sync_playwright() as p:
    run(p, "m", {"width": 390, "height": 844}, True)
    run(p, "d", {"width": 1280, "height": 860}, False)
    run(p, "k", {"width": 390, "height": 844}, True, dark=True)

STOP_SITE()
print("\n=== BILAN ===")
print("Tout est bon." if not problems else "\n".join(problems))
sys.exit(1 if problems else 0)
