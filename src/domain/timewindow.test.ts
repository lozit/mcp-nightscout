import { describe, expect, it } from "vitest";
import { calendarDay, profileTimeZone, TimeWindowError, zonedDayStart } from "./timewindow.js";

describe("zonedDayStart", () => {
  it("cadre minuit local, pas minuit UTC", () => {
    // Paris en août est à UTC+2 : minuit local = 22:00 UTC la veille.
    const t = zonedDayStart("2026-08-18", "Europe/Paris");
    expect(new Date(t).toISOString()).toBe("2026-08-17T22:00:00.000Z");
  });

  it("suit l'heure d'hiver", () => {
    // Paris en janvier est à UTC+1.
    const t = zonedDayStart("2026-01-15", "Europe/Paris");
    expect(new Date(t).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("reste juste le jour du changement d'heure", () => {
    // Bascule française fin mars : le décalage change dans la journée. Sans la
    // deuxieme passe, minuit se decale d'une heure, soit douze releves CGM du
    // mauvais cote de la frontiere.
    const t = zonedDayStart("2026-03-29", "Europe/Paris");
    expect(new Date(t).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("coïncide avec UTC pour un fuseau à décalage nul", () => {
    expect(new Date(zonedDayStart("2026-08-18", "UTC")).toISOString()).toBe(
      "2026-08-18T00:00:00.000Z",
    );
  });

  it("gère un fuseau à décalage non entier", () => {
    // Kolkata est à UTC+5:30 — le cas qui casse toute arithmétique en heures.
    expect(new Date(zonedDayStart("2026-08-18", "Asia/Kolkata")).toISOString()).toBe(
      "2026-08-17T18:30:00.000Z",
    );
  });

  it("refuse une date mal formée sans réafficher la valeur", () => {
    expect(() => zonedDayStart("18/08/2026", "UTC")).toThrow(TimeWindowError);
    try {
      zonedDayStart("18/08/2026", "UTC");
    } catch (e) {
      expect((e as Error).message).not.toContain("18/08");
    }
  });

  it("refuse un fuseau inconnu", () => {
    expect(() => zonedDayStart("2026-08-18", "Mars/Olympus")).toThrow(TimeWindowError);
  });
});

describe("calendarDay", () => {
  it("couvre exactement 24 h hors changement d'heure", () => {
    const w = calendarDay("2026-08-18", "Europe/Paris");
    expect(w.until - w.since).toBe(24 * 3_600_000);
  });

  it("couvre 23 h le jour où l'on avance les pendules", () => {
    // Le jour de la bascule, la journée locale ne fait pas 24 h. Une fenêtre
    // fixée à 24 h déborderait sur le lendemain.
    const w = calendarDay("2026-03-29", "Europe/Paris");
    expect(w.until - w.since).toBe(23 * 3_600_000);
  });

  it("couvre 25 h le jour où l'on recule les pendules", () => {
    const w = calendarDay("2026-10-25", "Europe/Paris");
    expect(w.until - w.since).toBe(25 * 3_600_000);
  });

  it("franchit correctement une fin de mois", () => {
    const w = calendarDay("2026-08-31", "Europe/Paris");
    expect(new Date(w.until).toISOString()).toBe("2026-08-31T22:00:00.000Z");
  });

  it("étiquette la fenêtre avec le fuseau appliqué", () => {
    expect(calendarDay("2026-08-18", "Europe/Paris").label).toBe("2026-08-18 (Europe/Paris)");
  });
});

describe("profileTimeZone", () => {
  it("lit le fuseau du profil actif", () => {
    expect(
      profileTimeZone({
        defaultProfile: "Default",
        store: { Default: { timezone: "Europe/Paris" }, Other: { timezone: "UTC" } },
      }),
    ).toBe("Europe/Paris");
  });

  it("rend undefined si le profil n'en porte pas", () => {
    expect(profileTimeZone({ defaultProfile: "Default", store: { Default: {} } })).toBeUndefined();
    expect(profileTimeZone(null)).toBeUndefined();
    expect(profileTimeZone({})).toBeUndefined();
  });
});
