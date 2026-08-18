<!-- generated-by: groundrules v1.10.0 -->
# 0004 — Méthode d'agrégation glycémique

**Date**: 2026-08-18
**Status**: Accepted

## Contexte

La contrainte #5 impose une agrégation « côté serveur, bornée, déterministe », et
le critère d'acceptation n°5 exige que chaque chiffre **égale le rapport Nightscout
sur la même fenêtre, vérifié à la main**. Ces deux exigences ne disent pas *comment*
calculer, et chaque choix laissé implicite produit un écart inexplicable au moment
de la vérification.

Différence de nature avec le reste du projet, qui justifie cet ADR : la sécurité
échoue bruyamment — un token qui fuit se voit, un identifiant invalide lève. **Une
moyenne fausse ne lève rien.** Elle sort un nombre plausible, et personne ne
remarque. Les décisions ci-dessous sont donc écrites pour être contestables et
re-vérifiables, pas pour être élégantes.

## Décisions

### 1. Seuils du consensus, jamais les cibles du profil

Bandes en mg/dL : très bas `< 54`, bas `54-69`, **cible `70-180`**, haut `181-250`,
très haut `> 250` (Battelino et al. 2019).

Le profil Nightscout porte `target_low` / `target_high`, et il aurait été tentant de
s'en servir « puisqu'ils sont là ». Ce sont les cibles de **régulation** d'une
boucle, propres à la personne et modifiables ; les bornes du TIR sont une convention
de **mesure**. Les confondre produit un nombre qui n'est comparable à rien — ni à la
littérature, ni au chiffre de la même personne le mois précédent si elle a ajusté
ses cibles entre-temps.

**Conséquence assumée** : si l'instance Nightscout est configurée avec d'autres
seuils d'affichage, nos pourcentages différeront des siens. Les seuils appliqués
sont donc **publiés dans chaque réponse**, pour que l'écart soit explicable au lieu
d'être suspect.

### 2. Les bandes sont des parts de relevés, pas du temps — et la couverture est publiée

« Time in range » se calcule ici comme *proportion de relevés* dans la plage. C'est
ce que fait Nightscout, donc c'est ce qui rend la vérification à la main possible.

Mais l'approximation ne disparaît pas parce que deux implémentations la partagent :
les deux ne coïncident que si les relevés sont régulièrement espacés. Un capteur
déconnecté six heures crée un trou, et les trous ne sont pas aléatoires — on perd un
capteur plus volontiers la nuit, ou pendant un épisode qu'on aurait justement voulu
compter.

D'où **`coverage`** dans chaque réponse : relevés obtenus / relevés attendus à un
toutes les 5 minutes. Sous 70 % — le seuil du consensus — un avertissement explicite
dit que les chiffres décrivent les relevés qui existent, pas la période demandée.
C'est la métadonnée qui manque à la plupart des rapports, et celle qui empêche un
modèle de commenter une moyenne calculée sur trois points.

### 2 bis. Inclusivité des bornes — vérifiée contre un rapport réel

Les bornes de bande sont **incluses des deux côtés** : `70 <= cible <= 180`. C'est la
définition du consensus, et c'est ce qui départage une valeur pile sur la borne.

Nightscout classe `>= 180` en *haut*, donc en exclut 180 de la cible. Sur la
journée du 2026-08-17, l'écart s'est chiffré exactement : Nightscout comptait 100
relevés hauts, nous 94, soit **6 relevés valant précisément 180** — 2,08 % de 288,
la totalité de l'écart de TIR observé (65,4 % contre 67,4 %, seuils bas alignés).

De même, la fenêtre calendaire est **`[minuit, minuit[`**, borne haute exclusive :
un relevé tombant pile à la frontière appartient au lendemain. Nightscout paraît
l'inclure, d'où 289 relevés contre 288.

Aucune des deux conventions n'est fausse. Elles sont écrites ici parce qu'un écart
de deux points sur un TIR, non expliqué, fait douter d'un calcul par ailleurs juste
— et pousse à « corriger » ce qui n'a pas besoin de l'être.

### 3. Écart-type d'échantillon (n-1)

Ces relevés sont un échantillon de la glycémie sur la fenêtre, pas la population
entière. Avec n≈288 l'écart avec le diviseur `n` est inférieur à 0,2 % — invisible,
sauf précisément lors d'une vérification à la main où il devient un doute inutile.
Le choix est donc consigné plutôt que laissé à deviner.

### 4. GMI par la formule de Bergenstal, sur la moyenne en mg/dL

`GMI(%) = 3.31 + 0.02392 × moyenne_mg/dL` (Bergenstal et al. 2018). Le GMI est un
pourcentage d'HbA1c estimée : il ne dépend pas de l'unité d'affichage choisie, et un
test vérifie qu'il ne bouge pas entre mg/dL et mmol/L — s'il bougeait, c'est qu'une
conversion aurait fui dans le calcul.

### 5. Tout est calculé en mg/dL, converti seulement en sortie

Nightscout stocke `sgv` en mg/dL **quelle que soit** la préférence d'affichage du
profil, et les seuils comme la formule du GMI sont définis dans cette unité.
Convertir en amont introduirait un arrondi dans chaque comparaison de seuil.

Cette décision est écrite parce que l'erreur inverse a été commise : le premier outil
de lecture publiait `sgv` brut étiqueté avec l'unité du profil, soit un facteur ~18
d'erreur sur une instance en mmol/L. Invisible sur l'instance de développement, qui
est en mg/dL. Corrigé, avec un test qui vérifie qu'une valeur reste du bon côté de la
borne dans les deux unités.

### 6. Pagination par curseur temporel, pas par `skip`

Un résumé sur 14 jours porte sur ~4000 relevés, au-delà du plafond de 1000 par
requête. Lire ces documents ne viole pas la contrainte #5 : ce qu'elle interdit,
c'est que des milliers de points atteignent le **modèle**, pas qu'on les lise pour
en tirer dix nombres.

Le parcours se fait par curseur `date$lt` décroissant plutôt que par `skip`, pour
deux raisons : `skip` décale toute la fenêtre si un document est inséré pendant le
parcours — et un CGM écrit toutes les 5 minutes, donc cela arrive — et le curseur ne
dépend pas du support de `skip` par l'instance. Un plafond dur de 30 000 documents
borne le pire cas, et une troncature est signalée dans la réponse.

## Alternatives considérées

- **Utiliser les cibles du profil pour le TIR** — rejeté, cf. §1 : produit un chiffre
  incomparable qui *ressemble* à un TIR.
- **TIR pondéré par le temps** — plus juste en présence de trous, mais alors nos
  chiffres ne seraient plus vérifiables contre Nightscout, ce qui casse le seul
  moyen de contrôle dont on dispose. Écarté au profit de la publication de
  `coverage`, qui rend le défaut visible sans le masquer.
- **Ne publier que le TIR** — rejeté. Un TIR de 70 % avec 25 % en hypoglycémie et un
  TIR de 70 % avec 25 % en hyperglycémie ne décrivent pas la même situation. Les cinq
  bandes sont publiées ensemble.

## Conséquences

### Positives
- Chaque chiffre est vérifiable à la main contre Nightscout, et chaque écart possible
  a une explication publiée (seuils, couverture, diviseur de l'écart-type).
- `coverage` empêche de commenter une statistique non représentative.

### Négatives / Compromis
- Les pourcentages restent une approximation du temps. C'est assumé et dit dans
  chaque réponse, pas corrigé.
- Les seuils fixes divergeront d'une instance configurée autrement. Volontaire, et
  rendu explicable par la publication des seuils appliqués.

### Neutres
- Les métriques cliniques avancées (GRI, LBGI/HBGI, AGP) restent hors périmètre
  (`docs/VISION.md`) : elles relèvent de la justesse clinique, un risque distinct et
  bien plus coûteux à valider que celui traité ici.

## Vérification contre l'instance réelle (2026-08-17)

Comparaison à la main avec le rapport *Distribution* de Nightscout sur la même
journée calendaire, seuils bas alignés à 70 :

| | Nightscout | ici | écart |
|---|---|---|---|
| relevés | 289 | 288 | 1 — inclusivité de la borne de fin |
| moyenne | 159,6 | 159 | arrondi |
| médiane | 142,5 | 142 | arrondi |
| écart-type | 43,8 | 44 | arrondi |
| en cible | 65,4 % | 67,4 % | 6 relevés valant exactement 180 |

Le GMI (7,1 %) n'est **pas** comparable à l'« A1c estimation » de Nightscout
(7,2 %) : Bergenstal 2018 ici, Nathan 2008 là. Que les deux tombent à un dixième
l'un de l'autre est une coïncidence numérique, pas une validation.

Cette vérification a aussi révélé deux défauts, corrigés :

1. **La fenêtre débordait sur tout l'historique.** Combiner `date$gte` et `date$lt`
   sur le même champ annule la première condition : une journée demandée rendait
   2243 relevés, soit 7,8 jours. Aucune erreur levée — seulement des chiffres faux
   et plausibles. La pagination n'envoie plus qu'un seul filtre temporel, et les
   deux bornes sont vérifiées **localement** sur les documents reçus.
2. **La couverture était plafonnée à 1**, ce qui affichait « 100 % » sur une fenêtre
   7,8 fois trop large. Une sur-couverture est un signal d'anomalie ; la borner la
   transformait en son contraire.

Le premier n'a été trouvé que parce que les chiffres ont été comparés à la main à
une source indépendante. Les tests unitaires passaient dans les deux cas.

## Notes

Sources : Battelino et al., *Clinical Targets for Continuous Glucose Monitoring Data
Interpretation*, Diabetes Care 2019 (seuils et couverture) ; Bergenstal et al.,
*Glucose Management Indicator (GMI)*, Diabetes Care 2018 (formule).
