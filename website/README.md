# thiloschauff.de

Einfache, statische Website für Thilo Schauff – ohne Baukasten, ohne Cookies, ohne Tracking.

| Datei | Inhalt |
| --- | --- |
| `index.html` | Startseite (Über mich, Verständnis, Werdegang, Heute, Kontakt) |
| `impressum.html`, `datenschutz.html` | Rechtstexte – **gelb markierte Stellen ergänzen** |
| `kontakt.php` | Verschickt das Kontaktformular per E-Mail (Empfänger oben in der Datei) |
| `bilder/portrait.jpg` | Portrait hier ablegen (Hochformat, ca. 1200 × 1500 px). Ohne Bild erscheint ein „TS“-Monogramm auf Putz. |
| `bilder/titelbild.jpg` | Optionales Titelbild (Querformat, ca. 2400 × 1400 px), z. B. ein Gebäude. Ohne Bild erscheint eine Putz-Struktur. |
| `style.css`, `script.js`, `fonts/` | Gestaltung, Animationen, Formular; Schrift Inter Tight (lokal, OFL-Lizenz) |

## Online stellen (ca. 30 Minuten)

1. **Domain + E-Mail-Paket buchen** bei einem deutschen Hoster mit PHP-Webspace,
   z. B. all-inkl.com, Strato, IONOS oder Hetzner (ab ca. 3–6 € / Monat).
   Dort `thiloschauff.de` registrieren – Webspace und Postfächer sind im Paket enthalten.
2. **Postfach anlegen** im Kundenmenü des Hosters (z. B. `thilo@thiloschauff.de`) und im Mailprogramm/iPhone einrichten.
3. **Adresse eintragen**: In `kontakt.php` `EMPFAENGER` (und `ABSENDER`) anpassen und die angezeigte
   Adresse in `index.html`, `script.js`, `impressum.html`, `datenschutz.html` ersetzen (Suchen & Ersetzen nach `thilo@schauff.de`).
4. **Hochladen**: Den Inhalt dieses Ordners per FTP (z. B. FileZilla) oder Dateimanager des Hosters in das Hauptverzeichnis der Domain kopieren.
5. **SSL einschalten** (kostenloses Let's-Encrypt-Zertifikat im Kundenmenü), damit die Seite über `https://` läuft.
6. **Testen**: Formular einmal ausfüllen – die Mail muss im Postfach ankommen. Antworten geht direkt per „Antworten“.

## Lokal ansehen

```sh
cd website
php -S localhost:8000
```
