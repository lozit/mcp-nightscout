#!/usr/bin/env node
import { createInterface } from "node:readline";
import { storeToken, storedHosts } from "../credentials.js";

/**
 * Range le token Nightscout dans le trousseau du système.
 *
 * Raison d'être : sans cela, la seule façon de fournir le token est
 * `NIGHTSCOUT_TOKEN=...` sur une ligne de commande — donc dans l'historique du
 * shell, dans la liste des processus, et dans tout transcript où la commande est
 * copiée. C'est arrivé le 2026-08-18 (`docs/LEARNINGS.md`).
 *
 * La saisie se fait sans écho et n'est jamais réaffichée, pas même tronquée.
 */

function ask(question: string, silent = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });

  if (silent) {
    // Neutralise l'écho : le terminal n'affiche rien pendant la frappe. `readline`
    // n'expose pas d'option pour ça, d'où l'accès à l'interne — la seule
    // alternative serait d'afficher le secret, ce qui est le problème qu'on traite.
    const internals = rl as unknown as { _writeToOutput: (s: string) => void };
    const original = internals._writeToOutput.bind(rl);
    internals._writeToOutput = (s: string) => {
      if (s.includes(question)) original(s);
    };
  }

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (silent) process.stderr.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const known = storedHosts();
  if (known.length > 0) {
    process.stderr.write(`Hôtes déjà enregistrés : ${known.join(", ")}\n`);
  }

  const rawUrl = process.env["NIGHTSCOUT_URL"] ?? (await ask("URL Nightscout (https://…) : "));

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    process.stderr.write("URL invalide.\n");
    process.exit(2);
  }
  if (url.protocol !== "https:") {
    process.stderr.write("L'URL doit être en https:// — refus.\n");
    process.exit(2);
  }

  const token = await ask("Token du sujet `readable` (saisie masquée) : ", true);
  if (!token) {
    process.stderr.write("Aucun token saisi.\n");
    process.exit(2);
  }
  if (/^[0-9a-f]{40}$/i.test(token)) {
    // Même garde qu'au démarrage : ne pas laisser un secret admin entrer, même
    // dans le trousseau.
    process.stderr.write(
      "Cette valeur ressemble à un API_SECRET haché, pas à un token de sujet. Refus.\n",
    );
    process.exit(2);
  }

  storeToken(url.host, token);
  // Le nom de l'hôte n'est pas un secret ; le token n'est jamais réaffiché.
  process.stderr.write(`Token enregistré dans le trousseau pour ${url.host}.\n`);
  process.stderr.write("Vous pouvez maintenant lancer le serveur sans NIGHTSCOUT_TOKEN.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Échec : ${(error as Error).message}\n`);
  process.exit(1);
});
