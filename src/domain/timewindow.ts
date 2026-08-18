/**
 * Fenêtres temporelles calendaires.
 *
 * Les rapports Nightscout sont **calendaires** — minuit à minuit, dans le fuseau
 * du profil — alors qu'une fenêtre « dernières 24 h » est glissante. Comparer
 * les deux directement produit un écart parfaitement légitime qui se lit comme un
 * bug. Le critère d'acceptation n°5 exige une vérification à la main : elle n'a de
 * sens que si les deux côtés cadrent la même période.
 *
 * Le fuseau vient du profil (`store[actif].timezone`), jamais de la machine : le
 * serveur peut tourner ailleurs que là où la personne vit, et un décalage d'un
 * fuseau déplace la frontière de journée — donc déplace un repas d'un jour à
 * l'autre.
 */

/** Décalage du fuseau, en ms, à un instant donné (gère l'heure d'été). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    // Intl rend 24 pour minuit dans certains environnements.
    Number(parts["hour"]) % 24,
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - utcMs;
}

export class TimeWindowError extends Error {
  override readonly name = "TimeWindowError";
}

/**
 * Instant UTC de minuit local, pour une date `YYYY-MM-DD` dans un fuseau donné.
 *
 * Deux passes : la première estime le décalage à partir d'une supposition UTC, la
 * seconde le recalcule à l'instant corrigé. Sans elle, une date située le jour d'un
 * changement d'heure se décale d'une heure — soit douze relevés CGM du mauvais côté
 * de la frontière.
 */
export function zonedDayStart(date: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new TimeWindowError(`Date must be YYYY-MM-DD (got ${date.length} characters).`);
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];

  let utc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  try {
    utc -= zoneOffsetMs(utc, timeZone);
    utc = Date.UTC(y, mo - 1, d, 0, 0, 0) - zoneOffsetMs(utc, timeZone);
  } catch {
    throw new TimeWindowError(`Unknown time zone in profile: ${timeZone}`);
  }
  return utc;
}

export interface CalendarWindow {
  readonly since: number;
  readonly until: number;
  readonly label: string;
}

/** Fenêtre `[minuit du jour ; minuit du lendemain[` dans le fuseau du profil. */
export function calendarDay(date: string, timeZone: string): CalendarWindow {
  const since = zonedDayStart(date, timeZone);
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const nextDate = new Date(Date.UTC(y, mo - 1, d + 1));
  const next = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`;
  return { since, until: zonedDayStart(next, timeZone), label: `${date} (${timeZone})` };
}

/** Fuseau déclaré par le profil actif, ou `undefined` s'il n'en porte pas. */
export function profileTimeZone(profile: unknown): string | undefined {
  if (typeof profile !== "object" || profile === null) return undefined;
  const p = profile as { defaultProfile?: unknown; store?: Record<string, unknown> };
  const name = typeof p.defaultProfile === "string" ? p.defaultProfile : undefined;
  if (!name) return undefined;
  const active = p.store?.[name] as { timezone?: unknown } | undefined;
  return typeof active?.timezone === "string" ? active.timezone : undefined;
}
