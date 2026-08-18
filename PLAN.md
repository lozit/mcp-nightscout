<!-- generated-by: groundrules v1.10.0 -->
# PLAN — mcp-nightscout

**Active** plan/todo for the project. Maintained by Claude during work.

This file differs from the long-term roadmap (`docs/ROADMAP.md`): it describes what is happening **now**.

## In progress

  `docs/SECURITY.md` § Incidents survenus.

- [ ] **Milestone 5 — agrégats vérifiables** (moyenne, TIR, CV, GMI). C'est là que se joue le
  critère d'acceptation n°5 : chaque agrégat doit **égaler le rapport Nightscout sur la même
  fenêtre, vérifié à la main**. La fidélité de la lecture sous-jacente est acquise (2026-08-18) ;
  ce qui reste à prouver est l'arithmétique, pas la donnée.

## Up next

- [ ] First read tool end-to-end against a real instance, to validate the whole chain before widening.

## Ideas — to triage

- [ ] Decide the free-text neutralization strategy for `notes` (delimit / truncate / strip) — likely deserves its own ADR.
- [ ] Decide whether aggregates are separate tools or parameters on the read tools.

## Waiting / blocked

- [ ] **`treatments` et `devicestatus` sont vides, et le resteront à court terme** — sondés le
  2026-08-18, `result: []` pour les deux. Confirmé le 2026-08-18 : aucun traitement n'est saisi
  dans cette instance, donc ce n'est pas une attente de quelques jours. Conséquences fermes :
  - la forme de `notes` reste inconnue ;
  - aucun agrégat dépendant de l'insuline ou des glucides n'est vérifiable ;
  - tout outil touchant `treatments` est repoussé après le reste.

  **Ne bloque PAS la contrainte #6**, contrairement à ce qui était écrit ici : `entries.device`
  est également écrit par un tiers (l'uploader) et présent dans les données réelles. La
  neutralisation du texte libre peut donc être conçue et testée sur `device` maintenant, puis
  étendue à `notes` sans rien redécouvrir le jour où des traitements existent.
- [ ] **Which `units` is authoritative** — the profile carries `units` both at top level and
  inside `store[<name>]`. They agree today (single profile) and will diverge silently later. Read
  from the active store entry and fail loudly on disagreement until settled.

## Recently done

- [x] **Milestone 3 clos — chaîne validée contre l'instance réelle** (2026-08-18) — 36 relevés
  sur 3 h (un toutes les 5 min), unité `mg/dL` résolue depuis le profil actif, `device` balisé
  sans sur-neutralisation. **Valeurs comparées à la main aux rapports Nightscout : conformes.**
  Ce qui est prouvé : la chaîne de lecture est fidèle. Ce qui ne l'est pas encore : les agrégats,
  qui n'existent pas — le critère d'acceptation n°5 reste ouvert.
- [x] **Incident token traité** (2026-08-18) — token exposé dans un transcript, révoqué et
  remplacé ; `mcp-nightscout-login` ajouté (saisie masquée → trousseau). Vérifié en réel : le
  serveur lit l'instance **sans `NIGHTSCOUT_TOKEN` dans l'environnement**.
  `docs/SECURITY.md` § Incidents survenus.
- [x] **Premier outil MCP exposé** (2026-08-18) — `nightscout_recent_glucose` : unités résolues
  depuis le profil actif (échec bruyant si désaccord), `type !== "sgv"` écarté et compté,
  `device` neutralisé et balisé, fenêtre plafonnée à 24 h. Serveur stdio vérifié de bout en bout :
  `initialize` + `tools/list` répondent, stdout ne porte que du JSON-RPC, les journaux vont sur
  stderr, et le portail refuse les quatre cas dangereux. **68 tests.**
- [x] **Milestone 2 — squelette sûr, terminé** (2026-08-18) — échange token→JWT avec cache
  mémoire, partage des appels concurrents et ré-échange unique sur 401 (`src/upstream/auth.ts`) ;
  client v3 en Bearer d'en-tête, plafond de volume à 1000 et validation d'enveloppe
  (`src/upstream/client.ts`) ; portail de démarrage (`src/config.ts`) ; scrubbing deux niveaux
  (`src/security/`).
- [x] **Majeures de dépendances tranchées** (2026-08-18) — TS 7.0.2, zod 4.4.3, `@types/node` 26,
  après vérification que le SDK MCP accepte zod `^3.25 || ^4.0` et que l'arbre est dédupliqué sur
  une seule instance. [ADR 0003](docs/decisions/0003-dependency-majors.md).
- [x] **Payload shapes probed** (2026-08-18) — `entries` and `profile` recorded from real
  responses in [docs/DATA_MODEL.md](docs/DATA_MODEL.md); `treatments`/`devicestatus` empty.
  Constraint #4 confirmed: v3 uses `identifier`, no `_id`, and it is a 24-hex ObjectId here.
  Constraint #3 sharpened: the token is 27 chars, so pattern-only redaction misses it.
- [x] **v3 chosen, probed against the live instance** (2026-08-18) — version 15.0.7; the token→JWT exchange works and v3 reads succeed in-header, so the token leaves every data-fetch URL. [ADR 0002](docs/decisions/0002-nightscout-api-v3.md). Unblocks all of "Up next".
- [x] Frame fixed and published: stdio-only, read-only, TypeScript on the official MCP SDK — [ADR 0001](docs/decisions/0001-language-and-stack.md) (2026-08-18)
- [x] Project bootstrapped (2026-08-18)

---

**Convention**: Claude updates this file at the start/end of each session. Completed tasks stay in "Recently done" for ~1 week then are archived (deleted or moved to CHANGELOG).

**Status vocabulary**: `[ ]` to do · `[~]` delivered, in review / awaiting validation · `[x]` done & validated. Annotate reverts and key commits inline (e.g. `reverted (commit abc123)`) — intermediate states are information, don't erase them.
