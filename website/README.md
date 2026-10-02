# thiloschauff.de

Einfache, statische Website für Thilo Schauff – ohne Baukasten, ohne Cookies, ohne Tracking.

| Datei | Inhalt |
| --- | --- |
| `index.html` | Startseite (Über mich, Verständnis, Werdegang, Heute, Kontakt) |
| `impressum.html`, `datenschutz.html` | Rechtstexte – **gelb markierte Stellen ergänzen** |
| `kontakt.php` | Verschickt das Kontaktformular per E-Mail (Empfänger oben in der Datei) |
| `bilder/portrait.jpg` | Portrait (Hochformat). Wird oben rechts neben dem Text gezeigt. |
| `style.css`, `script.js`, `fonts/` | Gestaltung, Uhr, Animationen, Formular; Schrift Inter Tight (lokal, OFL-Lizenz) |

## Online stellen: Website auf Netlify, Domain und E-Mail bei netcup

**Netlify (Website)**
1. Auf netlify.com: *Add new site → Import an existing project → GitHub* → Repository `Manager-`,
   Branch `claude/festive-mendel-qekfbw`. Die Einstellungen kommen aus `netlify.toml` (Ordner `website/`).
2. *Site configuration → Forms*: Formularerkennung aktivieren. Unter *Form notifications* eine
   E-Mail-Benachrichtigung an `kontakt@thiloschauff.de` anlegen.
3. *Domain management → Add a domain*: `thiloschauff.de` eintragen. HTTPS richtet Netlify selbst ein.

**netcup (Domain und Postfach)**
1. Im netcup-Kundenbereich (CCP) die Domain `thiloschauff.de` registrieren.
2. Postfach `kontakt@thiloschauff.de` anlegen (braucht ein netcup-Paket mit E-Mail, z. B. Webhosting)
   und im Mailprogramm/iPhone einrichten.
3. DNS der Domain bei netcup: `A`-Eintrag für `@` auf `75.2.60.5`, `CNAME` für `www` auf
   `<name>.netlify.app`. Die MX-Einträge für E-Mail bleiben bei netcup.

Änderungen an der Website: auf GitHub in den Branch pushen – Netlify veröffentlicht automatisch.

**Alternative ohne Netlify:** Alles bei netcup-Webhosting hochladen. Dann im Formular in `index.html`
`action="kontakt.php"` setzen und `data-netlify` / `netlify-honeypot` entfernen – `kontakt.php` verschickt
die Mails dann selbst.

## Lokal ansehen

```sh
cd website
php -S localhost:8000
```
