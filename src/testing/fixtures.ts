/**
 * Valeurs factices partagées par les tests.
 *
 * Aucune n'est un secret — et, ce qui compte tout autant, **aucune n'en a
 * l'apparence statistique**. Des littéraux à haute entropie dans un dépôt public
 * déclenchent les scanners de secrets : huit alertes sur des fichiers de test
 * apprennent à en ignorer une neuvième, qui sera vraie. Le bruit d'un détecteur
 * coûte plus cher que son absence.
 *
 * Les valeurs gardent la **forme** que le code doit reconnaître (suffixe de 16
 * hexadécimaux pour un token de sujet, trois segments base64url pour un JWT) et
 * abandonnent l'entropie : hexadécimal séquentiel, motifs répétés, segments
 * assemblés à l'exécution plutôt qu'écrits en dur.
 */

/**
 * Token de sujet Nightscout : `<nom>-<16 hex>`, 24 caractères.
 *
 * Sous les 32 caractères d'un détecteur par longueur — c'est précisément le
 * constat qui fonde l'enregistrement par valeur (`docs/LEARNINGS.md`).
 */
export const FAKE_TOKEN = "example-0123456789abcdef";
export const OTHER_FAKE_TOKEN = "second-0123456789abcdef";

/** Un `API_SECRET` haché : 40 hexadécimaux, sans entropie. */
export const FAKE_HASHED_SECRET = "0123456789".repeat(4);

function segment(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * JWT de forme valide, assemblé au moment de l'exécution.
 *
 * Le fichier source ne contient donc aucune chaîne base64 : un scanner n'a rien
 * à signaler, alors que la valeur produite commence bien par `eyJ` et porte ses
 * trois segments — ce que le scrubber doit reconnaître.
 */
export function fakeJwt(subject: string): string {
  return [
    segment({ alg: "HS256", typ: "JWT" }),
    segment({ sub: subject }),
    "not-a-real-signature",
  ].join(".");
}

export const FAKE_JWT_A = fakeJwt("a");
export const FAKE_JWT_B = fakeJwt("b");

/**
 * Blob opaque de 36 caractères, pour éprouver le motif de dernier recours :
 * assez long, contient chiffres et lettres, et se répète — donc reconnaissable
 * par la règle sans être reconnaissable par un détecteur d'entropie.
 */
export const FAKE_OPAQUE_BLOB = "Ab1".repeat(12);

/** ObjectId Mongo : 24 hexadécimaux, séquentiels. C'est la forme qui compte. */
export const FAKE_OBJECT_ID = "0123456789abcdef01234567";

/** UUID nul de la RFC 4122, variante 4. Aucune entropie. */
export const FAKE_UUID = "00000000-0000-4000-8000-000000000000";
