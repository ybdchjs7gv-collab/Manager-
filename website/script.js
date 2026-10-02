document.documentElement.classList.add("js");

// Uhrzeit in Soest (Europe/Berlin), wie in einer Studio-Kopfzeile
const uhr = document.getElementById("uhr");
if (uhr) {
  const format = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const tick = () => { uhr.textContent = format.format(new Date()); };
  tick();
  setInterval(tick, 15000);
}

const jahr = document.getElementById("jahr");
if (jahr) jahr.textContent = new Date().getFullYear();

// Sanftes Einblenden beim Scrollen
const elemente = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
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
  document.getElementById("f-zeit").value = Date.now();

  if (new URLSearchParams(location.search).get("gesendet") === "1") {
    status.textContent = "Vielen Dank – Ihre Nachricht ist angekommen.";
    status.className = "formular__status ok";
  }

  const zeige = (text, art) => {
    status.textContent = text;
    status.className = "formular__status " + art;
  };

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
      document.getElementById("f-zeit").value = Date.now();
      zeige("Vielen Dank – Ihre Nachricht ist angekommen. Ich melde mich zeitnah.", "ok");
    } catch (fehler) {
      zeige("Das hat leider nicht geklappt. Schreiben Sie gern direkt an thilo@schauff.de.", "fehler");
    } finally {
      knopf.disabled = false;
    }
  });
}
