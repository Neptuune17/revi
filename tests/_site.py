"""Sert une copie de l'appli avec un config.js choisi, pour tester sans toucher au vrai projet Firebase."""
import os, shutil, tempfile, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_LOCAL = "window.REVI_CONFIG = { firebase: null };"
FAKE_FIREBASE = '{ apiKey: "AIzaFakeKeyForTest000000000000000000", authDomain: "revi-test.firebaseapp.com", projectId: "revi-test", appId: "1:123:web:abc" }'

def config_cloud(require_login=False):
    return f"window.REVI_CONFIG = {{ requireLogin: {'true' if require_login else 'false'}, firebase: {FAKE_FIREBASE} }};"

class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def make_site(config_js):
    """Copie l'appli dans un dossier temporaire, remplace config.js et la sert. Renvoie (url, arrêt)."""
    tmp = tempfile.mkdtemp(prefix="revi-site-")
    site = os.path.join(tmp, "site")
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns(".git", "tests", "tools", "__pycache__"))
    with open(os.path.join(site, "config.js"), "w") as f:
        f.write(config_js)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=site))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://localhost:{httpd.server_address[1]}/"
    def stop():
        httpd.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    return url, stop
