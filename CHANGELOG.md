<!-- generated-by: groundrules v1.10.0 -->
# Changelog

All notable changes to this project are documented in this file.

Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `nightscout_glucose_summary` — agrégats déterministes côté serveur : moyenne, médiane,
  écart-type, CV, GMI et les cinq bandes du consensus, sur fenêtre glissante ou jour calendaire
  cadré dans le fuseau du profil. Vérifié à la main contre le rapport Nightscout
  ([ADR 0004](docs/decisions/0004-aggregation-method.md))
- Pagination par fenêtre temporelle (`readWindow`), ascendante et à filtre unique, pour agréger
  au-delà du plafond de 1000 documents par requête
- `nightscout_recent_glucose` — premier outil de lecture, validé contre une instance réelle :
  unités résolues depuis le profil actif, relevés non-CGM écartés et comptés, champ `device`
  neutralisé et balisé, fenêtre plafonnée à 24 h
- `mcp-nightscout-login` / `-logout` — dépôt du token dans le trousseau, saisie masquée, pour
  qu'aucun secret n'ait à transiter par une variable d'environnement ou une ligne de commande
- `scripts/smoke.mjs` — harnais stdio ; sortie caviardée par défaut, `--full` sur demande
- Safe skeleton: boot gate (`src/config.ts`), two-level secret scrubbing
  (`src/security/`), upstream error types with identifier validation
  (`src/upstream/errors.ts`), keychain access (`src/credentials.ts`). 33 tests.
- ADR 0003 — dependency majors: TypeScript 7.0.2, zod 4.4.3, `@types/node` 26,
  adopted after verifying the MCP SDK accepts zod `^3.25 || ^4.0` and the tree
  dedupes to a single zod instance
- Project documentation structure bootstrapped with groundrules on 2026-08-18
- ADR 0002 — talk to Nightscout over API v3, decided against the live instance (version 15.0.7): the readable token is exchanged once for a JWT and every read is Bearer-authenticated in-header, so the token leaves every data-fetch URL

### Changed

### Deprecated

### Removed

### Fixed
- Les valeurs `sgv` étaient publiées brutes sous l'étiquette d'unité du profil. Nightscout stocke
  toujours en mg/dL : sur un profil en mmol/L, l'outil rendait des valeurs fausses d'un facteur 18
  et parfaitement crédibles
- La fenêtre d'agrégation débordait sur tout l'historique : deux conditions sur le même champ
  (`date$gte` et `date$lt`) annulent la première côté amont
- La couverture était plafonnée à 1, ce qui affichait « 100 % » sur une fenêtre 7,8 fois trop
  large. Une sur-couverture est désormais signalée comme l'anomalie qu'elle est

### Security
- Secret scrubbing is two-level (registered literals + patterns) and applied at
  render time, including `Error.stack` and `cause`. The measured Nightscout token
  is 27 characters, below the 32-character floor a pattern-only redactor uses —
  value registration is what covers it.
- All logging goes to stderr; stdout is the MCP JSON-RPC channel.

<!--
## [0.1.0] - YYYY-MM-DD

### Added
- ...
-->
