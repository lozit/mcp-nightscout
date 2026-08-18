<!-- generated-by: groundrules v1.10.0 -->
# 0003 — Majeures de dépendances : TypeScript 7, zod 4, @types/node 26

**Date**: 2026-08-18
**Status**: Accepted

## Contexte

L'ADR 0001 fixe la stack (TypeScript sur le SDK MCP officiel) et indique que les
conventions suivent `mcp-standardnotes`, la référence maison la mieux outillée.
Au moment de poser le scaffold, l'installation en versions exactes (contrainte #1,
« dépendances épinglées ») a résolu vers des majeures plus récentes que celles des
deux repos maison :

| Paquet | Maison (`mcp-freestyle` / `mcp-standardnotes`) | Ici |
|---|---|---|
| TypeScript | `^5.6` / `^5.4` | **7.0.2** |
| zod | `^3.25` / `^3.23` | **4.4.3** |
| `@types/node` | `^22` / `^20` | **26.2.0** |

Épingler en exact et prendre la dernière majeure n'est pas la même décision que
suivre la ligne maison. Il fallait trancher explicitement plutôt que laisser
`--save-exact` décider.

Le risque réel n'était pas TypeScript ni `@types/node` — c'était **zod 4**. Le SDK
MCP a longtemps été couplé à zod 3, et une double instance de zod dans l'arbre
casse silencieusement la validation de schémas (`instanceof` échoue d'une instance
à l'autre), ce qui se manifeste comme un outil MCP qui refuse ses propres
arguments valides.

## Décision

**Adopter les majeures récentes : TypeScript 7.0.2, zod 4.4.3, `@types/node` 26.**

Vérifié avant d'acter, sur l'arbre réellement installé :

```
@modelcontextprotocol/sdk@1.30.0
  dependencies.zod      : "^3.25 || ^4.0"
  peerDependencies.zod  : "^3.25 || ^4.0"

npm ls zod --all
  └── zod@4.4.3   (dédupliqué — une seule instance dans tout l'arbre)
```

Le SDK supporte donc zod 4 explicitement, et l'arbre est dédupliqué sur une seule
instance : le mode de panne redouté n'existe pas ici. Typecheck et suite de tests
passent (33 tests).

## Alternatives considérées

- **S'aligner sur la ligne maison (TS 5, zod 3, types/node 20-22)** — rejeté. Le
  seul argument était l'homogénéité de flotte, et il ne paie pas sur un projet
  neuf : cela reviendrait à démarrer sur une majeure de zod que le SDK considère
  déjà comme l'ancienne, et à devoir migrer plus tard sur du code d'outils MCP
  déjà écrit. Migrer zod 3→4 coûte plus cher après les schémas qu'avant.
- **Laisser des plages `^`** — rejeté : la contrainte #1 demande des dépendances
  épinglées, et un `^` reporte la décision sur le prochain `npm install`.

## Conséquences

### Positives
- zod 4 dès le départ : pas de migration de schémas d'outils à faire plus tard.
- Versions exactes partout + `package-lock.json` commité : la contrainte #1 est
  satisfaite au sens littéral, pas seulement via le lockfile.

### Négatives / Compromis
- **La flotte n'est plus homogène.** L'ADR 0001 dit « les conventions suivent
  `mcp-standardnotes` » ; c'est vrai de la *forme* (npm, vitest, structure `src/`)
  et faux des *versions*. À garder en tête en portant un extrait de code d'un
  repo à l'autre — en particulier tout schéma zod.
- TypeScript 7 est le compilateur natif, récent. En cas de comportement suspect,
  la première hypothèse à tester est le compilateur, pas le code.

### Neutres — un constat mesuré au passage, qui nuance l'ADR 0001
L'ADR 0001 annonçait « une empreinte de 3 dépendances runtime ». C'est vrai des
dépendances **directes** (`@modelcontextprotocol/sdk`, `@napi-rs/keyring`, `zod`)
et faux de l'empreinte réelle : **96 paquets** en production une fois le
transitif résolu, dont une pile serveur HTTP complète tirée par le SDK —
`express`, `hono`, `@hono/node-server`, `cors`, `express-rate-limit`,
`eventsource`, `raw-body`.

Ces paquets **n'ouvrent rien par eux-mêmes** : aucun port n'est écouté tant qu'on
n'instancie pas un transport HTTP, et la décision stdio-only (ADR 0001) tient. Mais
ils sont bien dans l'arbre, donc dans la surface d'attaque *chaîne
d'approvisionnement*, et « 3 dépendances » ne doit pas être lu comme une garantie
de minimalisme. À vérifier à chaque montée de version du SDK : que la pile HTTP
reste inerte, et qu'aucun chemin de code ne l'instancie par défaut.

## Notes

Vérification refaite avec `npm ls zod --all` et
`npm ls --omit=dev --all` le 2026-08-18. Nuance l'ADR
[0001](0001-language-and-stack.md) § Conséquences sans le remplacer.
