const root = document.documentElement;
root.classList.add("js");
const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Auftakt: Vorhang nur beim ersten Besuch pro Sitzung ----
let schonGesehen = false;
try { schonGesehen = sessionStorage.getItem("vorhang") === "1"; } catch (e) {}
if (schonGesehen || ruhig) root.classList.add("ohne-vorhang");

const starten = () => requestAnimationFrame(() => {
  root.classList.add("geladen");
  // Vorhang nach dem Hochfahren ganz entfernen
  setTimeout(() => root.classList.add("ohne-vorhang"), 1300);
});
if (schonGesehen || ruhig) {
  starten();
} else {
  // Kurz zeigen, dann öffnen – spätestens nach 2,2 s, auch wenn Schriften noch laden
  const bereit = Promise.race([
    Promise.all([document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, 1400))]),
    new Promise((r) => setTimeout(r, 2200)),
  ]);
  bereit.then(() => {
    starten();
    try { sessionStorage.setItem("vorhang", "1"); } catch (e) {}
  });
}

// ---- Kopfzeile: über dem Titelbild transparent, danach weiß ----
const kopf = document.getElementById("kopf");
const hero = document.querySelector(".hero");
const grund = document.querySelector(".hero__grund");
const zeitleiste = document.getElementById("zeitleiste");

const beimScrollen = () => {
  const y = window.scrollY;
  if (kopf && hero) kopf.classList.toggle("kopf--fest", y > hero.offsetHeight - 90);
  if (grund && !ruhig && y < window.innerHeight * 1.2) grund.style.transform = `translate3d(0, ${y * 0.25}px, 0)`;
  if (zeitleiste) {
    const r = zeitleiste.getBoundingClientRect();
    const anteil = (window.innerHeight * 0.6 - r.top) / r.height;
    zeitleiste.style.setProperty("--fortschritt", Math.max(0, Math.min(1, anteil)).toFixed(3));
  }
};
let wartet = false;
window.addEventListener("scroll", () => {
  if (wartet) return;
  wartet = true;
  requestAnimationFrame(() => { beimScrollen(); wartet = false; });
}, { passive: true });
beimScrollen();

// ---- Jahre seit 1994, mit Hochzählen ----
const jahr = document.getElementById("jahr");
if (jahr) jahr.textContent = new Date().getFullYear();

const hochzaehlen = (el) => {
  const ziel = new Date().getFullYear() - Number(el.dataset.seit);
  if (ruhig) { el.textContent = ziel; return; }
  const dauer = 1600;
  const start = performance.now();
  const schritt = (t) => {
    const p = Math.min(1, (t - start) / dauer);
    el.textContent = Math.round(ziel * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
};

// ---- Sanftes Einblenden beim Scrollen ----
const elemente = document.querySelectorAll(".reveal");
const zaehler = document.querySelectorAll("[data-seit]");
if ("IntersectionObserver" in window) {
  const beobachter = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("sichtbar");
      e.target.querySelectorAll("[data-seit]").forEach(hochzaehlen);
      beobachter.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -10% 0px" });
  elemente.forEach((el) => beobachter.observe(el));
} else {
  elemente.forEach((el) => el.classList.add("sichtbar"));
  zaehler.forEach((el) => { el.textContent = new Date().getFullYear() - Number(el.dataset.seit); });
}

// ---- Kontaktformular ----
const formular = document.getElementById("formular");
if (formular) {
  const status = document.getElementById("status");
  const knopf = formular.querySelector("button[type=submit]");
  const zeitFeld = document.getElementById("f-zeit");
  zeitFeld.value = Date.now();

  const zeige = (text, art) => {
    status.textContent = text;
    status.className = "formular__status " + art;
  };

  if (new URLSearchParams(location.search).get("gesendet") === "1") {
    zeige("Vielen Dank – Ihre Nachricht ist angekommen.", "ok");
  }

  formular.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    let ok = true;
    for (const feld of formular.querySelectorAll("input[required], textarea[required]")) {
      const gueltig = feld.type === "checkbox" ? feld.checked : feld.checkValidity() && feld.value.trim() !== "";
      feld.classList.toggle("ungueltig", !gueltig);
      if (!gueltig) ok = false;
    }
    if (!ok) {
      zeige("Bitte füllen Sie die markierten Felder aus und bestätigen Sie die Einwilligung.", "fehler");
      return;
    }

    knopf.disabled = true;
    zeige("Wird gesendet …", "");

    try {
      const antwort = await fetch(formular.action, {
        method: "POST",
        body: new FormData(formular),
        headers: { Accept: "application/json" },
      });
      const daten = await antwort.json().catch(() => ({}));
      if (!antwort.ok || !daten.ok) throw new Error(daten.fehler || "Versand fehlgeschlagen");
      formular.reset();
      zeitFeld.value = Date.now();
      zeige("Vielen Dank – Ihre Nachricht ist angekommen. Ich melde mich zeitnah.", "ok");
    } catch (fehler) {
      zeige("Das hat leider nicht geklappt. Schreiben Sie gern direkt an thilo@schauff.de.", "fehler");
    } finally {
      knopf.disabled = false;
    }
  });
}
