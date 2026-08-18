#!/usr/bin/env node
import { deleteToken, storedHosts } from "../credentials.js";

/** Retire un token du trousseau. À utiliser après toute révocation côté Nightscout. */
const host = process.argv[2] ?? storedHosts()[0];

if (!host) {
  process.stderr.write("Aucun hôte enregistré.\n");
  process.exit(2);
}

process.stderr.write(
  deleteToken(host)
    ? `Token supprimé du trousseau pour ${host}.\n`
    : `Aucun token en trousseau pour ${host}.\n`,
);
