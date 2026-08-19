#!/usr/bin/env node
/**
 * Harnais stdio : lance le serveur et appelle un outil pour de vrai.
 *
 * Le serveur est stdio, donc il n'y a rien à ouvrir dans un navigateur : on lui
 * écrit du JSON-RPC sur stdin et on lit ses réponses sur stdout.
 *
 * Usage :
 *   export NIGHTSCOUT_URL="https://votre-instance"
 *   export NIGHTSCOUT_TOKEN="<token readable>"       # ou trousseau
 *   node scripts/smoke.mjs                            # relevés masqués, agrégats affichés
 *   node scripts/smoke.mjs --full                     # valeurs réelles incluses
 *   node scripts/smoke.mjs --hours 6
 *   node scripts/smoke.mjs --date 2026-08-18       # jour calendaire, comparable
 *                                                  # a un rapport Nightscout
 *
 * **Par défaut, aucune valeur de glycémie n'est affichée** : seulement la forme,
 * les unités, les décomptes et les avertissements. C'est suffisant pour valider la
 * chaîne. Passez `--full` quand vous voulez vérifier les chiffres à la main contre
 * les rapports Nightscout — c'est la seule façon d'y arriver, mais ça met des
 * données de santé à l'écran, donc c'est un choix explicite.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const full = args.includes("--full");
const hours = Number(args[args.indexOf("--hours") + 1]) || 3;
const days = Number(args[args.indexOf("--days") + 1]) || 1;
const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;

if (!process.env.NIGHTSCOUT_URL) {
  console.error("NIGHTSCOUT_URL n'est pas défini.");
  process.exit(2);
}

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let nextId = 1;

createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("\n!! NON-JSON SUR STDOUT — le protocole est corrompu :", line.slice(0, 200));
    process.exit(1);
  }
  const resolve = pending.get(msg.id);
  if (resolve) {
    pending.delete(msg.id);
    resolve(msg);
  }
});

function call(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout sur ${method}`)), 20_000);
  });
}

/** Remplace chaque scalaire par son type, en gardant les noms de champs. */
function shape(v) {
  if (Array.isArray(v)) return v.length === 0 ? [] : [shape(v[0])];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return typeof v;
}

try {
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const res = await call("tools/call", {
    name: "nightscout_recent_glucose",
    arguments: { hours },
  });

  if (res.error) {
    console.error("\n=== ERREUR JSON-RPC ===");
    console.error(JSON.stringify(res.error, null, 2));
    process.exit(1);
  }
  if (res.result?.isError) {
    console.error("\n=== L'OUTIL A ÉCHOUÉ ===");
    console.error(res.result.content?.[0]?.text ?? JSON.stringify(res.result));
    process.exit(1);
  }

  const payload = JSON.parse(res.result.content[0].text);

  console.log("\n=== CHAÎNE VALIDÉE ===");
  console.log("unité résolue :", payload.unit, "(depuis le profil actif, jamais supposée)");
  console.log("bornes TIR    :", JSON.stringify(payload.targetRange));
  console.log("fenêtre       :", payload.windowHours, "h (demandé :", hours + ")");
  console.log("relevés       :", payload.count);
  if (payload.notes?.length) {
    console.log("écartés       :");
    for (const n of payload.notes) console.log("  -", n);
  } else {
    console.log("écartés       : aucun");
  }

  const first = payload.readings?.[0];
  if (first) {
    console.log("\n=== CONTRAINTE #6 — champ tiers-écrit ===");
    console.log("valeurs distinctes :", payload.devices?.length ?? 0,
      "(publiées une fois, pas par relevé — ADR 0005)");
    for (const d of payload.devices ?? []) console.log("  ", d);
    console.log("index dans le relevé :", first.device, "(un entier, il ne peut rien porter)");
    console.log("\n=== FORME D'UN RELEVÉ ===");
    console.log(JSON.stringify(shape(first), null, 2));
  }

  // --- Résumé agrégé -------------------------------------------------------
  const sum = await call("tools/call", {
    name: "nightscout_glucose_summary",
    arguments: date ? { date } : { days },
  });

  if (sum.error || sum.result?.isError) {
    console.log("\n=== RÉSUMÉ : ÉCHEC ===");
    console.log(sum.result?.content?.[0]?.text ?? JSON.stringify(sum.error, null, 2));
  } else {
    const g = JSON.parse(sum.result.content[0].text);
    console.log(`\n=== RÉSUMÉ AGRÉGÉ ===`);
    console.log("fenêtre     :", g.window);
    console.log("de / à      :", g.since, "->", g.until);
    console.log("relevés     :", g.count, "sur ~" + g.expected, "attendus");
    console.log("couverture  :", Math.round(g.coverage * 100) + "%",
      g.coverage > 1.5 ? "  <-- DENSITÉ ANORMALE" : "");
    if (g.duplicatesDropped) console.log("doublons    :", g.duplicatesDropped, "écartés");
    if (g.medianIntervalSeconds !== undefined) {
      console.log("intervalle  :", g.medianIntervalSeconds + "s (médian observé)");
    }
    // Les agrégats ne sont pas des relevés : ce sont les chiffres à comparer aux
    // rapports Nightscout, donc ils s'affichent sans --full.
    console.log("moyenne     :", g.mean, g.unit);
    console.log("médiane     :", g.median, g.unit);
    console.log("écart-type  :", g.sd, g.unit, "(échantillon, n-1)");
    console.log("CV          :", g.cv + "%");
    console.log("GMI         :", g.gmi + "%");
    console.log("seuils      :", JSON.stringify(g.thresholds), g.unit);
    console.log("bandes (% de relevés) :");
    console.log("  très bas  :", g.bands.veryLow + "%");
    console.log("  bas       :", g.bands.low + "%");
    console.log("  EN CIBLE  :", g.bands.inRange + "%");
    console.log("  haut      :", g.bands.high + "%");
    console.log("  très haut :", g.bands.veryHigh + "%");
    if (g.caveats?.length) {
      console.log("réserves :");
      for (const c of g.caveats) console.log("  -", c);
    }
  }

  if (full) {
    console.log("\n=== VALEURS RÉELLES (--full) ===");
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("\n(relevés individuels masqués — --full pour les afficher)");
  }
} catch (err) {
  console.error("\n=== ÉCHEC ===");
  console.error(err.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
