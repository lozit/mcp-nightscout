<!-- generated-by: groundrules v1.10.0 -->
# 0005 — Neutralisation du texte libre tiers-écrit

**Date**: 2026-08-19
**Status**: Accepted

## Contexte

La contrainte #6 impose que « les champs texte libre soient neutralisés avant d'entrer
dans les résultats d'outils ». Elle dit *quoi*, pas *comment*, et l'implémentation posée
au premier outil était explicitement provisoire.

Le vecteur : tout champ d'une instance Nightscout écrit par un tiers — n'importe quel
uploader ou intégration disposant d'un accès en écriture — arrive **verbatim** dans le
contexte du modèle. Le cas nommé par l'audit est `treatments.notes` ; `entries.device` a
exactement le même statut et présente l'avantage d'exister dans les données réelles, ce
qui a permis de concevoir et d'éprouver la neutralisation sans attendre.

La lecture seule (ADR 0001) supprime la **conséquence exploitable** d'une instruction
injectée *dans ce serveur* : il n'y a pas d'outil d'écriture à détourner. Elle ne supprime
pas le **vecteur** — le texte entre quand même dans le contexte, et le modèle dispose
d'autres outils, dans d'autres serveurs.

Il fallait trancher maintenant plutôt qu'après : la stratégie est centralisée dans un seul
fichier, et rien de nouveau ne viendra éclairer le choix — `treatments` est vide et le
restera à court terme.

## Décisions

### 1. Ne pas chercher à détecter des instructions

Aucune liste de motifs, aucun filtre sur « ignore les instructions précédentes » et
consorts.

Ce n'est pas de la paresse, c'est un refus assumé : toute liste de motifs se contourne —
par la traduction, l'espacement, l'homoglyphe, la paraphrase — et un filtre qui attrape
les tentatives naïves donne surtout l'impression que le problème est traité. On échangerait
une borne réelle contre une fausse assurance, ce qui est un mauvais échange même quand le
filtre attrape quelque chose.

On agit donc uniquement sur ce qui est **mesurable et vérifiable** : le volume, les
caractères de structure, le nombre d'occurrences, et le fait que le champ soit annoncé
comme non fiable.

### 2. Neutraliser la structure, pas le sens

Trois opérations, dans cet ordre :

1. **Caractères de contrôle et séparateurs de ligne Unicode** (`\p{Cc}`, `\p{Zl}`, `\p{Zp}`)
   remplacés par une espace. Ce sont eux qui permettent de simuler une fin de bloc et de
   faire passer la suite pour autre chose que de la donnée. Écrits en propriétés Unicode
   plutôt qu'en plages ASCII : U+2028 et U+2029 échappent à toute plage ASCII.
2. **Caractères de balisage** (`` ` ``, `<`, `>`) retirés, pour la même raison.
3. **Troncature à 200 caractères.** Au-delà, un champ « libre » n'est plus une étiquette
   d'appareil ou une note courte : c'est une charge utile. La troncature ne rend pas
   l'injection impossible, elle borne ce qu'elle peut dire.

Le texte survit, en une ligne, borné. C'est le contrat, et il est assumé tel quel.

### 3. Baliser explicitement, et signaler la modification

Format : `[untrusted:<champ>] <valeur>`, avec un suffixe `(neutralized)` quand quelque
chose a été retiré.

Le balisage **n'est pas une protection** — un attaquant peut écrire un faux marqueur dans
son propre texte. C'est ce qui permet au modèle de *savoir* qu'il regarde une donnée et non
une consigne. Il vient **après** la neutralisation, jamais à sa place.

Choix du préfixe textuel plutôt que d'un objet structuré (`{value, untrusted: true}`) :
la valeur reste lisible telle quelle dans une sortie JSON, et le marqueur voyage avec elle
si le modèle la recopie ailleurs — ce qu'un attribut frère ne fait pas.

### 4. **Déduplication : une occurrence par réponse, référencée par index**

C'est la décision qui manquait, et la plus efficace des quatre.

`device` est identique sur tous les relevés d'une même fenêtre. L'implémentation initiale le
répétait à chaque relevé, ce qui donne, sur une fenêtre de 24 h :

| | mesuré |
|---|---|
| poids d'un relevé sérialisé | 117 octets |
| dont le champ tiers-écrit | 32 octets — **27 %** |
| sur 288 relevés | 33 Ko dont **9 Ko** de répétition pure |
| occurrences de la surface d'injection | **288** |

Désormais : les valeurs distinctes, neutralisées, sont publiées **une fois** dans un tableau
`devices` au niveau de la réponse, et chaque relevé porte un **index entier** vers ce
tableau.

Le gain de contexte est réel mais secondaire. Le gain qui compte est celui-ci : **une charge
utile hostile apparaît une fois au lieu de 288.** La répétition d'une instruction est en
elle-même un levier — un texte répété des centaines de fois pèse davantage sur un modèle
qu'une occurrence unique, indépendamment de son contenu. Réduire le nombre d'occurrences
est une mesure de sécurité, pas seulement d'économie.

L'index est un entier : il ne peut rien porter.

## Alternatives considérées

- **Filtrage par motifs d'instructions** — rejeté, cf. §1.
- **Suppression pure du champ** — rejetée : `device` renseigne sur la provenance d'un relevé,
  et une divergence de source explique des écarts de données. Supprimer l'information pour
  se protéger d'elle est une réponse trop grossière quand la borner suffit.
- **Encodage (base64) du champ** — rejeté : illisible pour l'humain qui relit une sortie, et
  un modèle décode de toute façon. On déplacerait le problème d'un cran sans le réduire.
- **Objet structuré `{value, untrusted}`** — cf. §3 : le marqueur ne voyage pas avec la
  valeur si elle est recopiée.

## Conséquences

### Positives
- Une occurrence de la surface d'injection par réponse au lieu d'une par relevé.
- 27 % de contexte en moins sur chaque relevé.
- Un point de passage unique : changer de stratégie coûte un fichier.
- Applicable tel quel à `notes` le jour où `treatments` sera peuplée, sans rien redécouvrir.

### Négatives / Compromis
- Lire un relevé demande de suivre un index vers le tableau `devices`. Une indirection de
  plus pour le lecteur humain comme pour le modèle.
- La troncature à 200 caractères perdra la fin d'une note longue légitime. Assumé : les
  notes de traitement sont courtes par usage, et le champ n'est pas le support d'un récit.
- **Rien ici n'empêche une injection d'être lue.** Le texte hostile arrive dans le contexte,
  en une ligne, borné et étiqueté. C'est la limite honnête de l'approche, et elle est écrite
  dans le README plutôt que passée sous silence.

### Neutres
- La neutralisation n'est éprouvée que sur `device`. Le jour où `treatments` porte des
  données, re-vérifier — le contrat ne change pas, mais la longueur typique des valeurs, si.

## Notes

Remplace la mention « stratégie provisoire, en attente d'un ADR » de `src/domain/freetext.ts`
et de `docs/ARCHITECTURE.md`.
