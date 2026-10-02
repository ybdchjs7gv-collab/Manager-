const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Uhrzeit in Soest (Europe/Berlin)
const uhr = document.getElementById("uhr");
if (uhr) {
  const format = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  const tick = () => { uhr.textContent = format.format(new Date()); };
  tick();
  setInterval(tick, 15000);
}

const jahr = document.getElementById("jahr");
if (jahr) jahr.textContent = new Date().getFullYear();

// Jahre seit 1994 – aktualisiert sich jedes Jahr von selbst
document.querySelectorAll("[data-seit]").forEach((el) => {
  el.textContent = new Date().getFullYear() - Number(el.dataset.seit);
});

// Linie unter der Kopfzeile, sobald gescrollt wird
const kopf = document.querySelector(".kopf");
if (kopf) {
  const pruefen = () => kopf.classList.toggle("kopf--linie", window.scrollY > 8);
  window.addEventListener("scroll", pruefen, { passive: true });
  pruefen();
}

// Sanftes Einblenden beim Scrollen
const elemente = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !ruhig) {
  const beobachter = new IntersectionObserver((eintraege) => {
    for (const e of eintraege) {
      if (e.isIntersecting) {
        e.target.classList.add("sichtbar");
        beobachter.unobserve(e.target);
      }
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  elemente.forEach((el) => beobachter.observe(el));
} else {
  elemente.forEach((el) => el.classList.add("sichtbar"));
}

// Kontaktformular
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
      const daten = new FormData(formular);
      if (formular.hasAttribute("data-netlify")) {
        // Netlify Forms: Netlify nimmt die Anfrage an und schickt sie per E-Mail weiter
        const antwort = await fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(daten).toString(),
        });
        if (!antwort.ok) throw new Error("Versand fehlgeschlagen");
      } else {
        // Eigenes Hosting mit PHP: kontakt.php verschickt die E-Mail
        const antwort = await fetch(formular.getAttribute("action"), {
          method: "POST",
          body: daten,
          headers: { Accept: "application/json" },
        });
        const ergebnis = await antwort.json().catch(() => ({}));
        if (!antwort.ok || !ergebnis.ok) throw new Error(ergebnis.fehler || "Versand fehlgeschlagen");
      }
      formular.reset();
      zeitFeld.value = Date.now();
      zeige("Vielen Dank – Ihre Nachricht ist angekommen. Ich melde mich zeitnah.", "ok");
    } catch (fehler) {
      zeige("Das hat leider nicht geklappt. Schreiben Sie gern direkt an kontakt@thiloschauff.de.", "fehler");
    } finally {
      knopf.disabled = false;
    }
  });
}
