// CalDAV-Zugriff (iCloud, GMX, Web.de, Nextcloud …) – Termine lesen und schreiben.
import { XMLParser } from "npm:fast-xml-parser@5.11.1";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["response", "propstat", "href", "comp", "privilege"].includes(name),
});

export function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

interface DavResponse {
  status: number;
  url: string;
  text: string;
  headers: Headers;
}

async function davFetch(
  url: string,
  init: { method: string; auth: string; depth?: string; body?: string; headers?: Record<string, string> },
): Promise<DavResponse> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const headers: Record<string, string> = { Authorization: init.auth };
    if (init.depth !== undefined) headers["Depth"] = init.depth;
    if (init.body) headers["Content-Type"] = "application/xml; charset=utf-8";
    Object.assign(headers, init.headers ?? {});
    const res = await fetch(current, { method: init.method, headers, body: init.body, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      const next = new URL(location, current);
      if (next.protocol !== "https:") throw new Error("Unsichere Weiterleitung vom Kalender-Server");
      current = next.toString();
      continue;
    }
    return { status: res.status, url: current, text: await res.text(), headers: res.headers };
  }
  throw new Error("Zu viele Weiterleitungen vom Kalender-Server");
}

// deno-lint-ignore no-explicit-any
type Xml = any;

interface DavEntry {
  href: string;
  props: Xml;
}

/** Parses a WebDAV multistatus body into href + successful props. */
export function parseMultistatus(xml: string): DavEntry[] {
  const doc = parser.parse(xml);
  const responses: Xml[] = doc?.multistatus?.response ?? [];
  return responses.map((r) => {
    const propstats: Xml[] = r.propstat ?? [];
    const ok = propstats.filter((p) => /\s200\s/.test(` ${p.status ?? ""} `));
    const props = Object.assign({}, ...ok.map((p) => (typeof p.prop === "object" ? p.prop : {})));
    const href = Array.isArray(r.href) ? r.href[0] : r.href;
    return { href: String(href ?? "").trim(), props };
  });
}

function firstHref(value: Xml): string | null {
  if (!value) return null;
  const href = value.href;
  if (Array.isArray(href)) return href[0] ? String(href[0]).trim() : null;
  return href ? String(href).trim() : null;
}

function textValue(value: Xml): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && "#text" in value) return String(value["#text"]).trim() || null;
  return null;
}

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;

const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;

const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:current-user-privilege-set/>
    <c:supported-calendar-component-set/>
    <cs:getctag/>
    <ic:calendar-color/>
  </d:prop>
</d:propfind>`;

export interface CalendarInfo {
  href: string;
  name: string;
  color: string | null;
  readOnly: boolean;
  ctag: string | null;
}

function checkAuth(res: DavResponse): void {
  if (res.status === 401 || res.status === 403) {
    throw new Error("Anmeldung am Kalender abgelehnt – bitte Apple-ID/E-Mail und app-spezifisches Passwort prüfen.");
  }
}

export async function discover(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ principalUrl: string; homeUrl: string; calendars: CalendarInfo[] }> {
  const auth = basicAuth(username, password);
  let res = await davFetch(serverUrl, { method: "PROPFIND", auth, depth: "0", body: PROPFIND_PRINCIPAL });
  checkAuth(res);
  if (res.status !== 207) {
    const wellKnown = new URL("/.well-known/caldav", serverUrl).toString();
    res = await davFetch(wellKnown, { method: "PROPFIND", auth, depth: "0", body: PROPFIND_PRINCIPAL });
    checkAuth(res);
  }
  if (res.status !== 207) throw new Error(`Kalender-Server antwortet unerwartet (${res.status}).`);
  const principalHref = parseMultistatus(res.text).map((e) => firstHref(e.props["current-user-principal"])).find(Boolean);
  if (!principalHref) throw new Error("Kalender-Konto nicht gefunden.");
  const principalUrl = new URL(principalHref, res.url).toString();

  const homeRes = await davFetch(principalUrl, { method: "PROPFIND", auth, depth: "0", body: PROPFIND_HOME });
  checkAuth(homeRes);
  const homeHref = parseMultistatus(homeRes.text).map((e) => firstHref(e.props["calendar-home-set"])).find(Boolean);
  if (!homeHref) throw new Error("Kalender-Verzeichnis nicht gefunden.");
  const homeUrl = new URL(homeHref, homeRes.url).toString();

  const calendars = await listCalendars(homeUrl, auth);
  return { principalUrl, homeUrl, calendars };
}

export function calendarsFromMultistatus(xml: string, baseUrl: string): CalendarInfo[] {
  const out: CalendarInfo[] = [];
  for (const entry of parseMultistatus(xml)) {
    const rt = entry.props.resourcetype;
    if (!rt || typeof rt !== "object" || !("calendar" in rt)) continue;
    const comps: Xml[] = entry.props["supported-calendar-component-set"]?.comp ?? [];
    const names = comps.map((c) => String(c?.["@_name"] ?? "").toUpperCase());
    if (names.length > 0 && !names.includes("VEVENT")) continue;
    const privileges: Xml[] = entry.props["current-user-privilege-set"]?.privilege ?? [];
    const privNames = privileges.flatMap((p) => (p && typeof p === "object" ? Object.keys(p) : []));
    const canWrite = privileges.length === 0 ||
      privNames.some((n) => ["write", "write-content", "all", "bind"].includes(n));
    let color = textValue(entry.props["calendar-color"]);
    if (color && /^#[0-9a-f]{8}$/i.test(color)) color = color.slice(0, 7);
    out.push({
      href: new URL(entry.href, baseUrl).toString(),
      name: textValue(entry.props.displayname) ?? "Kalender",
      color,
      readOnly: !canWrite,
      ctag: textValue(entry.props.getctag),
    });
  }
  return out;
}

export async function listCalendars(homeUrl: string, auth: string): Promise<CalendarInfo[]> {
  const res = await davFetch(homeUrl, { method: "PROPFIND", auth, depth: "1", body: PROPFIND_CALENDARS });
  checkAuth(res);
  if (res.status !== 207) throw new Error(`Kalenderliste nicht lesbar (${res.status}).`);
  return calendarsFromMultistatus(res.text, res.url);
}

export interface RemoteEvent {
  href: string;
  etag: string | null;
  ics: string;
}

function davUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function eventsFromMultistatus(xml: string, baseUrl: string): RemoteEvent[] {
  return parseMultistatus(xml)
    .map((e) => ({
      href: new URL(e.href, baseUrl).toString(),
      etag: textValue(e.props.getetag),
      ics: textValue(e.props["calendar-data"]) ?? "",
    }))
    .filter((e) => e.ics.includes("BEGIN:VCALENDAR"));
}

export async function fetchEvents(calendarUrl: string, auth: string, start: Date, end: Date): Promise<RemoteEvent[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${davUtc(start)}" end="${davUtc(end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
  const res = await davFetch(calendarUrl, { method: "REPORT", auth, depth: "1", body });
  checkAuth(res);
  if (res.status !== 207) throw new Error(`Termine nicht lesbar (${res.status}).`);
  return eventsFromMultistatus(res.text, res.url);
}

export function eventUrl(calendarUrl: string, uid: string): string {
  const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
  return new URL(`${encodeURIComponent(uid)}.ics`, base).toString();
}

export async function putEvent(
  url: string,
  auth: string,
  ics: string,
  etag: string | null,
): Promise<{ href: string; etag: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "text/calendar; charset=utf-8" };
  if (etag) headers["If-Match"] = etag;
  let res = await davFetch(url, { method: "PUT", auth, body: ics, headers });
  if (res.status === 412) {
    // Changed on the phone in the meantime: the app's version wins for app-owned events.
    delete headers["If-Match"];
    res = await davFetch(url, { method: "PUT", auth, body: ics, headers });
  }
  checkAuth(res);
  if (![200, 201, 204].includes(res.status)) throw new Error(`Termin nicht speicherbar (${res.status}).`);
  return { href: res.url, etag: res.headers.get("etag") };
}

export async function deleteEvent(url: string, auth: string): Promise<void> {
  const res = await davFetch(url, { method: "DELETE", auth });
  checkAuth(res);
  if (![200, 204, 404, 410].includes(res.status)) throw new Error(`Termin nicht löschbar (${res.status}).`);
}
