<?php
/**
 * Kontaktformular für thiloschauff.de
 * Läuft auf jedem üblichen Webhosting mit PHP (IONOS, Strato, all-inkl, …).
 * Es werden keine Daten gespeichert – die Anfrage geht nur per E-Mail raus.
 */

// ---- Einstellungen -------------------------------------------------------
// Hierhin gehen alle Anfragen:
const EMPFAENGER = 'kontakt@thiloschauff.de';
// Absender der Benachrichtigung. Muss eine Adresse der eigenen Domain sein,
// sonst landet die Mail beim Hoster gern im Spam.
const ABSENDER   = 'website@thiloschauff.de';
const BETREFF    = 'Neue Anfrage über thiloschauff.de';
// --------------------------------------------------------------------------

$istJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

function antwort(bool $ok, string $fehler = '', int $code = 200): void {
    global $istJson;
    http_response_code($code);
    if ($istJson) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'fehler' => $fehler]);
    } else {
        // Ohne JavaScript: zurück zur Seite
        header('Location: index.html' . ($ok ? '?gesendet=1' : '') . '#kontakt', true, 303);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    antwort(false, 'Nur POST erlaubt.', 405);
}

// Spam-Schutz: verstecktes Feld ausgefüllt oder Formular zu schnell abgeschickt → still verwerfen
$zeit = (int) ($_POST['t'] ?? 0);
if (!empty($_POST['website']) || ($zeit > 0 && (time() * 1000 - $zeit) < 2500)) {
    antwort(true);
}

$einzeilig = fn(string $s): string => trim(preg_replace('/[\r\n\t]+/', ' ', $s));

$name      = $einzeilig(mb_substr((string) ($_POST['name'] ?? ''), 0, 120));
$email     = $einzeilig(mb_substr((string) ($_POST['email'] ?? ''), 0, 200));
$firma     = $einzeilig(mb_substr((string) ($_POST['firma'] ?? ''), 0, 160));
$telefon   = $einzeilig(mb_substr((string) ($_POST['telefon'] ?? ''), 0, 60));
$nachricht = trim(mb_substr((string) ($_POST['nachricht'] ?? ''), 0, 5000));
$okay      = ($_POST['einwilligung'] ?? '') === 'ja';

if ($name === '' || $nachricht === '' || !$okay || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    antwort(false, 'Bitte alle Pflichtfelder korrekt ausfüllen.', 422);
}

$text = "Neue Anfrage über das Kontaktformular auf thiloschauff.de\n\n"
      . "Name:        $name\n"
      . "E-Mail:      $email\n"
      . ($firma   !== '' ? "Unternehmen: $firma\n" : '')
      . ($telefon !== '' ? "Telefon:     $telefon\n" : '')
      . "\nNachricht:\n$nachricht\n\n"
      . "—\nGesendet am " . date('d.m.Y \u\m H:i') . " Uhr. Einfach auf diese Mail antworten, um zu reagieren.\n";

$kopf = [
    'From: =?UTF-8?B?' . base64_encode('Website Thilo Schauff') . '?= <' . ABSENDER . '>',
    'Reply-To: =?UTF-8?B?' . base64_encode($name) . '?= <' . $email . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
];

$gesendet = mail(
    EMPFAENGER,
    '=?UTF-8?B?' . base64_encode(BETREFF . ' – ' . $name) . '?=',
    $text,
    implode("\r\n", $kopf),
    '-f' . ABSENDER
);

$gesendet ? antwort(true) : antwort(false, 'Versand fehlgeschlagen.', 500);
