<!-- generated-by: groundrules v1.10.0 -->
# 0006 — Un outil par granularité de sortie, un paramètre pour le reste

**Date**: 2026-08-19
**Status**: Accepted

## Contexte

Deux outils existent : `nightscout_recent_glucose` rend des relevés,
`nightscout_glucose_summary` rend des agrégats. La question se pose au moment
d'élargir la surface : faut-il continuer à ajouter des outils, ou fusionner en un
outil paramétré (`mode: "readings" | "summary"`) ?

L'objection sérieuse à la multiplication est le coût en contexte. La liste d'outils
est envoyée à chaque conversation : mesuré à deux outils, **1 882 octets, environ
470 tokens**, permanents. À cinq outils, il faut compter autour de 1 200 tokens.

Ce n'est pas négligeable, et il fallait un critère plutôt qu'un arbitrage au cas
par cas.

## Décision

**La granularité de sortie détermine le plafond de fenêtre, donc elle est un outil,
jamais un paramètre. Ce qui varie à granularité constante — durée, seuil, format —
est un paramètre.**

### Pourquoi la granularité et pas autre chose

Les deux outils actuels n'ont pas le même plafond, et ce n'est pas un réglage :
`recent_glucose` est borné à **24 h** parce qu'il rend des relevés bruts,
`glucose_summary` va jusqu'à **90 jours** parce qu'il rend une dizaine de nombres.
C'est la contrainte #5 exprimée dans la forme de l'API.

Fusionner transformerait ce plafond en **validation croisée** : *si
`mode = "readings"`, alors fenêtre ≤ 24 h*. Une règle de plus, écrite en code,
qu'on peut oublier, contourner, ou relâcher un jour pour débloquer un cas.

Séparés, la demande dangereuse — « les relevés bruts sur 14 jours » — n'est pas
**exprimable**. Elle ne peut pas être formulée, donc elle ne peut pas être refusée
par erreur.

C'est le raisonnement de l'ADR 0001 appliqué un cran plus bas : le choix de stdio
supprime des classes de vulnérabilités *structurellement plutôt que par
mitigation*. Ce qui est encodé dans la forme de l'API n'a pas à être défendu à
l'exécution.

### Application aux outils envisagés

| Candidat | Verdict | Raison |
|---|---|---|
| Profil thérapeutique (basal, ISF, ICR, DIA) | **outil** | Rend des segments horaires, pas des relevés. Autre granularité, autre plafond. |
| Coup d'œil : dernier relevé + tendance | **outil** | Rend un point unique. Plafond dégénéré : un relevé. |
| Épisodes hypo/hyper | **outil** | Rend des intervalles, pas des relevés. Le volume dépend du nombre d'épisodes, pas de la durée. |
| Comparaison de deux périodes | **paramètre** de `glucose_summary` | Même granularité de sortie, même plafond. Deux fenêtres au lieu d'une. |

Le critère écarte donc un outil sur les quatre envisagés.

## Alternatives considérées

- **Un outil paramétré par `mode`** — rejeté, cf. ci-dessus : déplace un invariant
  structurel vers une validation d'exécution.
- **Un outil par collection Nightscout** (`entries`, `profile`, `treatments`) —
  rejeté : c'est le découpage du stockage amont, pas celui des questions posées. Il
  produirait un outil `entries` obligé de tout rendre, du relevé brut à l'agrégat,
  et donc sans plafond cohérent.
- **Tout fusionner en un outil `query` avec un langage de requête** — rejeté sans
  hésitation : la surface d'attaque d'un interpréteur de requêtes est sans commune
  mesure avec le bénéfice, et le plafond de volume deviendrait indécidable
  statiquement.

## Conséquences

### Positives
- Le plafond de volume reste une propriété de la forme de l'API, pas une règle à
  faire respecter.
- Le critère tranche les cas futurs sans rouvrir le débat.
- Il **réduit** le nombre d'outils dans un cas sur quatre, à l'encontre de
  l'intuition qu'un critère « un outil par chose » multiplie les outils.

### Négatives / Compromis
- Environ 1 200 tokens de contexte permanent à cinq outils. Assumé.
- **Le vrai risque n'est pas le nombre mais la discernabilité.** Deux outils que le
  modèle confond coûtent plus cher qu'un outil complexe. `recent_glucose` et
  `glucose_summary` sont sans ambiguïté ; « épisodes » et « comparaison de
  périodes » auraient pu se lire tous deux comme « une analyse sur une fenêtre » —
  raison de plus pour que la comparaison soit un paramètre. Soigner les
  descriptions reste la contrepartie de ce choix.

### Neutres
- La cible de « ~10 outils » de l'ADR 0001 est caduque, pour une raison
  indépendante : `treatments` et `devicestatus` sont vides. Ce qui reste de faisable
  sur `entries` + `profile` fait quatre ou cinq outils.
