import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { addDays, localDate, localDateTime, tzOffsetMinutes, zonedToUtc } from "./time.ts";
import { htmlToText, stripQuotedReply } from "./text.ts";
import { isBulkMail, parseHeaderBlock, ruleCategory, unsubscribeTarget } from "./bulk.ts";
import { buildCalendar, foldLine, parseCalendarData } from "./ical.ts";
import { calendarsFromMultistatus, eventsFromMultistatus, eventUrl } from "./caldav.ts";

const TZ = "Europe/Berlin";

Deno.test("zonedToUtc berücksichtigt Sommer- und Winterzeit", () => {
  assertEquals(zonedToUtc("2026-07-01T10:00", TZ).toISOString(), "2026-07-01T08:00:00.000Z");
  assertEquals(zonedToUtc("2026-12-01T10:00", TZ).toISOString(), "2026-12-01T09:00:00.000Z");
  assertEquals(zonedToUtc("2026-03-29T03:30", TZ).toISOString(), "2026-03-29T01:30:00.000Z");
  assertEquals(zonedToUtc("2026-10-25T02:30", TZ).toISOString(), "2026-10-25T00:30:00.000Z");
  assertEquals(zonedToUtc("2026-03-29T02:30", TZ).toISOString(), "2026-03-29T01:30:00.000Z");
  assertEquals(zonedToUtc("2026-10-06", TZ).toISOString(), "2026-10-05T22:00:00.000Z");
  assertEquals(zonedToUtc("2026-10-06T10:00:00+02:00", TZ).toISOString(), "2026-10-06T08:00:00.000Z");
  assertEquals(tzOffsetMinutes(new Date("2026-07-01T00:00:00Z"), TZ), 120);
});

Deno.test("lokale Datumsangaben", () => {
  const d = new Date("2026-09-28T22:30:00Z");
  assertEquals(localDate(d, TZ), "2026-09-29");
  assertEquals(localDateTime(d, TZ), "2026-09-29T00:30");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("htmlToText macht aus HTML lesbaren Text", () => {
  const html = `<html><head><style>p{color:red}</style></head><body><p>Hallo&nbsp;Lisa,</p>
    <p>der Termin ist am <b>Dienstag</b> um 10&#58;00 Uhr.<br>Gr&uuml;&szlig;e</p><ul><li>Punkt 1</li><li>Punkt 2</li></ul></body></html>`;
  const text = htmlToText(html);
  assertStringIncludes(text, "Hallo Lisa,");
  assertStringIncludes(text, "der Termin ist am Dienstag um 10:00 Uhr.\nGrüße");
  assertStringIncludes(text, "• Punkt 1");
  assert(!text.includes("color:red"));
});

Deno.test("Zitate werden aus Antworten entfernt", () => {
  const body = "Passt gut!\n\nAm 28.09.2026 um 10:00 schrieb Max <max@example.org>:\n> Wollen wir uns treffen?";
  assertEquals(stripQuotedReply(body), "Passt gut!");
});

Deno.test("Newsletter-Erkennung über Kopfzeilen", () => {
  const headers = parseHeaderBlock(
    "List-Unsubscribe: <https://x.example/u?id=1>,\r\n <mailto:u@x.example>\r\nPrecedence: bulk\r\n",
  );
  assert(isBulkMail(headers, "news@x.example"));
  assertEquals(unsubscribeTarget(headers["list-unsubscribe"]), "https://x.example/u?id=1");
  assert(!isBulkMail(parseHeaderBlock("Feedback-ID: 123:abc\r\n"), "rechnung@shop.example"));
  assert(isBulkMail(parseHeaderBlock("Feedback-ID: 123:abc\r\n"), "newsletter@shop.example"));
  assertEquals(ruleCategory(false, "Ihre Rechnung Nr. 4711", ""), "rechnung");
  assertEquals(ruleCategory(true, "Ihre Rechnung", ""), "newsletter");
});

Deno.test("ICS-Zeilen werden korrekt umgebrochen", () => {
  const long = "SUMMARY:" + "Ä".repeat(60);
  const folded = foldLine(long);
  for (const line of folded.split("\r\n")) {
    assert(new TextEncoder().encode(line).length <= 75, "Zeile zu lang");
  }
  assertEquals(folded.replace(/\r\n /g, ""), long);
});

Deno.test("ICS erzeugen und wieder einlesen", () => {
  const ics = buildCalendar(
    [
      {
        uid: "manager-1@manager",
        title: "Zahnarzt, Kontrolle; mit Notiz",
        description: "Zeile 1\nZeile 2",
        location: "Praxis Dr. Müller",
        start: new Date("2026-10-06T08:00:00Z"),
        end: new Date("2026-10-06T08:45:00Z"),
        allDay: false,
        reminderMinutes: 30,
      },
      {
        uid: "manager-2@manager",
        title: "Urlaub",
        start: zonedToUtc("2026-10-10", TZ),
        end: zonedToUtc("2026-10-12", TZ),
        allDay: true,
      },
    ],
    TZ,
    { feed: true, name: "Manager" },
  );
  assertStringIncludes(ics, "DTSTART;VALUE=DATE:20261010");
  assertStringIncludes(ics, "TRIGGER:-PT30M");
  const parsed = parseCalendarData(ics, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z"), TZ);
  assertEquals(parsed.length, 2);
  const zahnarzt = parsed.find((p) => p.uid === "manager-1@manager")!;
  assertEquals(zahnarzt.title, "Zahnarzt, Kontrolle; mit Notiz");
  assertEquals(zahnarzt.description, "Zeile 1\nZeile 2");
  assertEquals(zahnarzt.start.toISOString(), "2026-10-06T08:00:00.000Z");
  const urlaub = parsed.find((p) => p.uid === "manager-2@manager")!;
  assert(urlaub.allDay);
  assertEquals(urlaub.start.toISOString(), "2026-10-09T22:00:00.000Z");
  assertEquals(urlaub.end.toISOString(), "2026-10-11T22:00:00.000Z");
});

const ICLOUD_SERIES = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iPhone OS 26.0//EN
CALSCALE:GREGORIAN
BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
DTSTART:19810329T020000
TZNAME:MESZ
TZOFFSETTO:+0200
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
DTSTART:19961027T030000
TZNAME:MEZ
TZOFFSETTO:+0100
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:ABC-123
DTSTART;TZID=Europe/Berlin:20260915T180000
DTEND;TZID=Europe/Berlin:20260915T190000
RRULE:FREQ=WEEKLY;BYDAY=TU
EXDATE;TZID=Europe/Berlin:20261006T180000
SUMMARY:Yoga
DTSTAMP:20260901T100000Z
END:VEVENT
BEGIN:VEVENT
UID:ABC-123
RECURRENCE-ID;TZID=Europe/Berlin:20261013T180000
DTSTART;TZID=Europe/Berlin:20261013T190000
DTEND;TZID=Europe/Berlin:20261013T200000
SUMMARY:Yoga (später)
DTSTAMP:20260901T100000Z
END:VEVENT
END:VCALENDAR`;

Deno.test("Serien aus iCloud werden mit Ausnahmen und Zeitumstellung aufgelöst", () => {
  const parsed = parseCalendarData(ICLOUD_SERIES, new Date("2026-09-28T00:00:00Z"), new Date("2026-11-04T00:00:00Z"), TZ);
  const starts = parsed.map((p) => `${p.title}@${p.start.toISOString()}`);
  assertEquals(starts, [
    "Yoga@2026-09-29T16:00:00.000Z",
    "Yoga (später)@2026-10-13T17:00:00.000Z",
    "Yoga@2026-10-20T16:00:00.000Z",
    "Yoga@2026-10-27T17:00:00.000Z",
    "Yoga@2026-11-03T17:00:00.000Z",
  ]);
  assert(parsed.every((p) => p.uid === "ABC-123" && p.instance !== ""));
});

Deno.test("Zeitzone ohne Definition fällt auf Berlin zurück", () => {
  const ics =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;TZID=Europe/Berlin:20261201T090000\r\nDTEND;TZID=Europe/Berlin:20261201T100000\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const [ev] = parseCalendarData(ics, new Date("2026-11-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), TZ);
  assertEquals(ev.start.toISOString(), "2026-12-01T08:00:00.000Z");
});

const CALENDAR_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/1234/calendars/</href>
    <propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat>
  </response>
  <response>
    <href>/1234/calendars/home/</href>
    <propstat>
      <prop>
        <displayname>Privat</displayname>
        <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
        <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VEVENT"/></supported-calendar-component-set>
        <calendar-color xmlns="http://apple.com/ns/ical/">#FF2968FF</calendar-color>
        <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set>
        <getctag xmlns="http://calendarserver.org/ns/">HwoQEgwAAA</getctag>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234/calendars/tasks/</href>
    <propstat>
      <prop>
        <displayname>Erinnerungen</displayname>
        <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
        <supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name="VTODO"/></supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234/calendars/shared/</href>
    <propstat>
      <prop>
        <displayname>Familie</displayname>
        <resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>
        <current-user-privilege-set><privilege><read/></privilege></current-user-privilege-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

Deno.test("Kalenderliste aus CalDAV-Antwort", () => {
  const cals = calendarsFromMultistatus(CALENDAR_LIST, "https://p42-caldav.icloud.com/1234/calendars/");
  assertEquals(cals.map((c) => c.name), ["Privat", "Familie"]);
  assertEquals(cals[0].href, "https://p42-caldav.icloud.com/1234/calendars/home/");
  assertEquals(cals[0].color, "#FF2968");
  assertEquals(cals[0].readOnly, false);
  assertEquals(cals[1].readOnly, true);
});

Deno.test("Termine aus CalDAV-REPORT", () => {
  const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/1234/calendars/home/ABC-123.ics</d:href><d:propstat><d:prop>
  <d:getetag>"etag-1"</d:getetag><c:calendar-data>${ICLOUD_SERIES.replace(/&/g, "&amp;")}</c:calendar-data>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const events = eventsFromMultistatus(xml, "https://p42-caldav.icloud.com/1234/calendars/home/");
  assertEquals(events.length, 1);
  assertEquals(events[0].etag, '"etag-1"');
  assertStringIncludes(events[0].ics, "RRULE:FREQ=WEEKLY");
  assertEquals(
    eventUrl("https://p42-caldav.icloud.com/1234/calendars/home", "manager-1@x"),
    "https://p42-caldav.icloud.com/1234/calendars/home/manager-1%40x.ics",
  );
});
