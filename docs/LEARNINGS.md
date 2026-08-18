<!-- generated-by: groundrules v1.10.0 -->
# Learnings — mcp-nightscout

Rules learned from corrections and non-trivial discoveries during the project. Reverse-chronological order (newest at the top). **Re-read at session start.**

One entry = one **actionable rule**, not a journal note. Each entry has:
- a title that states the rule (imperative or "X: do Y");
- **Why** — the story behind it: what happened, what it cost (a revert, a lost CI cycle, a confused user…);
- **When to apply** — the concrete trigger conditions, so the rule fires at the right moment instead of being remembered too late.

Include the minimal code snippet / command when it is the fix.

---

## Ne jamais faire passer un secret par une ligne de commande — fournir le trousseau d'abord

**Why**: le 2026-08-18, le token `readable` de l'instance a été exposé en clair dans un transcript
de conversation et dans l'historique du shell, parce que la commande de test proposée était de la
forme `export NIGHTSCOUT_TOKEN="<token>" && npm run smoke`. Le token a dû être révoqué et recréé.

La cause n'est pas l'inattention de celui qui a collé la commande : c'est que **le chemin le plus
simple pour fournir le token était le chemin qui l'expose**. `src/credentials.ts` savait déjà lire
le trousseau, mais rien ne permettait d'y *écrire* — donc la variable d'environnement était la
seule option praticable. Un contrôle qui existe mais qu'aucun outil ne rend accessible ne protège
personne.

Une ligne de commande fuit sur trois canaux à la fois : l'historique du shell, la table des
processus (`ps` la montre aux autres utilisateurs de la machine), et tout copier-coller.

**When to apply**: avant de demander à quiconque — humain ou agent — de fournir un secret pour
tester. La question à se poser n'est pas « est-ce que je fais attention ? » mais « quel est le
chemin le plus court, et est-ce qu'il expose le secret ? ». Si oui, construire le chemin sûr
*avant* de demander. Ici : `npm run login` (saisie masquée, écriture trousseau), et le serveur
démarre ensuite sans aucune variable d'environnement portant le secret.

**Corollaire pour les harnais de test** : `NIGHTSCOUT_URL` peut rester en variable
d'environnement — ce n'est pas un secret. Seul le token doit passer par le trousseau.

## A greedy redaction pattern destroys the diagnostic and gets switched off

**Why**: the last-resort "long opaque blob" pattern was copied with `/` inside its character
class (`[A-Za-z0-9+/_-]{32,}`). Run against a real rendered stack, it turned
`…/api/v2/authorization/request/<token>` into `…example.[REDACTED]/[REDACTED]` and every stack
file path into `file:///[REDACTED].mjs` — because `example/tok-1a2b…` reads as one 34-character
run. The secret was gone, and so was every clue about where the failure happened. A redactor that
eats the diagnostic is one the next person disables while debugging, and then it protects nothing.

Caught by producing a **behaviour diff** — running a real throw through the real logger and
reading stderr — not by the unit tests, which all passed both before and after.

**When to apply**: any regex whose job is to match "something secret-looking". Exclude path
separators (`/`, `+`) from the class, and require the run to contain **both a digit and a letter**
so hyphenated paths don't match on length alone. Then re-run the behaviour diff and read the
output — assert on what survives, not only on what disappears.

## Pattern-only secret redaction is not enough — register the literal value at startup

**Why**: the house redactor (`mcp-standardnotes/src/security/redact.ts`) scrubs by pattern only —
`/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g`, i.e. anything token-shaped and **at least 32 characters**.
That is correct for Standard Notes, whose session tokens are long base64. It is **wrong here, and
measurably so**: the Nightscout readable token on this instance is **27 characters**, probed
2026-08-18. The regex never fires on it. A redactor copied from the house reference would pass its
own tests, look right in review, and write the token to disk verbatim the first time an upstream
call threw.

This is exactly what constraint #3 means by "**two-level**": by *value* (the literal secret and its
URL-encoded forms, registered at startup) **and** by *pattern*. The pattern half alone is a
coverage illusion.

**When to apply**: when implementing the logger, and any time a secret-scrubbing implementation is
adopted from elsewhere. Ask what length and alphabet its pattern assumes, then measure the actual
secret. Also register the **JWT** at each exchange, not just at boot — it rotates, so a
boot-time-only registration goes stale (ADR 0002).

**Corollary — keep the key-name half.** `SENSITIVE_KEY_RE` in the same file already covers `jwt`
and `authorization`, which is precisely what the v3 auth flow introduces. Take that part as-is.

## Never write to stdout in a stdio MCP server

**Why**: stdout **is** the JSON-RPC channel. A single `console.log` — including one left in by a
dependency — corrupts the protocol stream, and the symptom is an unintelligible MCP client error
rather than anything pointing at logging. Both house MCP servers write logs to `process.stderr`
for this reason; neither says why, so it reads as style rather than as a hard constraint.

**When to apply**: every log statement, every debug print, every temporary trace. If a diagnostic
must be seen, it goes to stderr. Consider it worth a lint rule banning `console.log` in `src/`.

## Fresh analysis means fresh: don't mine the other projects unasked

**Why**: this project exists because an evaluated third-party server was audited and rejected.
Its value is in being reasoned from its own threat model rather than assembled from whatever was
nearby. Pulling patterns from the other repos in `~/Projets/` without being asked reintroduces
exactly the borrowed assumptions the restart was meant to shed — and does it invisibly, since
the import leaves no trace in the reasoning.

**When to apply**: any time something outside this repository looks relevant — a sibling project,
a house convention, a remembered implementation. **Say so and ask.** Do not import it on your own
initiative. Reading *this* repo's docs is not affected; this is about outside material.

## A scrubbing filter never sees the traceback — scrub at format time too

**Why**: the highest-quality implementation found while surveying the ecosystem scrubs the token
on two levels (by *value*, registering the literal token and its URL-encoded forms at startup;
and by *pattern*) and applies it via **both** a log filter and a formatter. The reason is
specific and easy to miss: a filter inspects the log record, but a traceback is only rendered
when the record is *formatted*. A filter-only implementation looks correct and still writes the
token to disk the first time an upstream HTTP call throws.

**When to apply**: when implementing or reviewing anything in the logging path, and whenever
reasoning about whether a secret can escape. Test it the only way that proves anything: cause a
real upstream failure and read what lands on disk. See `docs/SECURITY.md`.

## HTTP clients normalize `..` — an unvalidated id is a path traversal

**Why**: interpolating an identifier into a request path without validating it is not merely
sloppy. HTTP clients normalize `..` segments per RFC 3986, so an id like `../devicestatus` turns
a scoped operation on one collection into an arbitrary operation on any collection — carrying
whatever credential the client holds. This was verified experimentally during the audit, not
assumed.

**When to apply**: every identifier that reaches a URL, without exception. Mongo ObjectId =
`^[0-9a-fA-F]{24}$`. Validate before building the path, not inside the request.

## Read-only removes the consequence of prompt injection, not the vector

**Why**: it is tempting to treat read-only as closing the free-text problem. It does not. The
`notes` field of a treatment is written by any uploader or integration with write access to the
instance, and it reaches the model verbatim. Read-only means an injected instruction has no write
tool to reach for *in this server* — the injected text still enters the model's context, and the
model has other tools.

**When to apply**: whenever the answer to a security question is "but we're read-only". Ask
whether the claim addresses the vector or only the consequence. Free-text neutralization is a
separate, still-required control.

## Deux filtres sur le même champ ne survivent pas à une query-string — un seul, et borner localement

**Why**: la fenêtre d'agrégation combinait `date$gte` et `date$lt` pour cadrer une journée.
Résultat sur l'instance réelle : 2243 relevés rendus pour une journée qui en compte 288, soit
7,8 jours d'historique. La seconde condition annule la première, et **aucune erreur n'est levée** —
seulement une moyenne, un TIR et un écart-type faux et parfaitement plausibles. Les tests
unitaires passaient : ils mockaient l'amont, donc ils testaient ma croyance sur le filtrage, pas
le filtrage.

Ce qui a désigné le coupable n'est pas un debugger mais une arithmétique de coin de table :
2243 relevés × 300 s d'intervalle médian = 7,8 jours. La sortie contenait déjà la preuve.

**When to apply**: dès qu'une requête porte plus d'une condition sur le même champ. N'en envoyer
qu'une, et appliquer les autres bornes **localement sur les documents reçus** — y compris celle
que le serveur est censé avoir appliquée. Le filtrage amont est un moyen de réduire le volume,
jamais une garantie de justesse. Corollaire de pagination : parcourir en **ascendant**, ce qui
place les insertions concurrentes en fin de parcours où elles sont inoffensives.

## Ne jamais borner un indicateur d'anomalie du côté qui le rend rassurant

**Why**: la couverture était calculée `Math.min(1, obtenus / attendus)`. Sur la fenêtre 7,8 fois
trop large ci-dessus, elle affichait donc **« 100 % »** — la valeur la plus rassurante possible,
au moment précis où les données étaient les plus fausses. Le plafond avait été écrit pour éviter
« 780 % », jugé laid. Il transformait un signal d'alarme en satisfecit.

**When to apply**: à tout ratio, score ou pourcentage qui sert d'indicateur de confiance. Se
demander ce que cache le clamp, et de quel côté. Dépasser 100 % de couverture attendue n'est
jamais bénin : c'est un second uploader, un backfill, ou une fenêtre qui déborde. Afficher la
valeur réelle et l'assortir d'un avertissement, plutôt que la rendre présentable.

## Comparer à une source indépendante trouve ce qu'aucun test unitaire ne trouvera

**Why**: les deux défauts ci-dessus ont survécu à une suite de tests verte parce que les tests
mockaient l'amont — ils vérifiaient que le code faisait ce que je croyais, et je me trompais sur
ce qu'il fallait croire. Ils ont été trouvés en mettant côte à côte notre sortie et le rapport
*Distribution* de Nightscout sur la même journée.

Le même exercice a aussi validé le reste : moyenne, médiane et écart-type concordent à l'arrondi,
et les deux écarts restants se chiffrent exactement (6 relevés valant précisément 180 pour l'écart
de TIR, un relevé de frontière pour l'écart de comptage). Un écart *expliqué au relevé près* est
une preuve ; un écart « faible » ne l'est pas.

**When to apply**: pour tout calcul dont le résultat est un nombre plausible en cas d'erreur —
agrégats, statistiques, conversions d'unité, fenêtres temporelles. Trouver une source
indépendante et comparer à la main avant de déclarer que ça marche. Et quand un écart subsiste,
le chiffrer jusqu'à ce qu'il s'explique : « proche » n'est pas une conclusion.

## Une fixture de test doit avoir la forme d'un secret, jamais son entropie

**Why**: GitGuardian a levé huit incidents « High » sur ce dépôt, tous dans des fichiers de test.
Aucun n'était un vrai secret. Le coût n'est pas là : c'est qu'un détecteur qui se trompe huit fois
devient un détecteur qu'on classe sans lire, et la neuvième alerte sera la vraie. Sur ce dépôt
précisément, un vrai token avait fui le même jour.

Le bruit était auto-infligé. Mes fixtures avaient des suffixes de 16 hexadécimaux aléatoires et
des segments base64 écrits en dur — une réalisme qui n'achète rien, puisque les tests vérifient
une **forme** (`-[0-9a-f]{16}$`, trois segments séparés par des points), jamais une entropie.

**When to apply**: à l'écriture de toute valeur factice ressemblant à un identifiant. Garder la
forme, supprimer l'entropie : hexadécimal séquentiel (`0123456789abcdef`), motifs répétés, et
pour un JWT, l'assembler à l'exécution depuis un objet JSON — le source ne porte alors aucune
chaîne encodée alors que la valeur produite commence bien par `eyJ`. Centraliser dans
`src/testing/`, exclu du build.

**Piège du nettoyage lui-même** : remplacer des fixtures touche des valeurs, pas de la logique,
donc on ne se relit pas. Une assertion `not.toContain("<ancienne constante>")` devient
silencieusement **toujours vraie** — elle passe au vert en ne testant plus rien. Après tout
remplacement de fixtures, vérifier par mutation qu'au moins un test sait encore devenir rouge.
