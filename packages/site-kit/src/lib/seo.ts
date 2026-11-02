/** Titre, description et données structurées (JSON-LD) — code pur depuis site.json. */
import type { Metier } from "../schema.ts";
import { site, nom, noteAffichee, tel } from "./site.ts";
import { horairesSchemaOrg } from "./format.ts";

const TYPE_SCHEMA: Record<Metier, string> = {
  electricien: "Electrician",
  plombier: "Plumber",
  chauffagiste: "HVACBusiness",
  couvreur: "RoofingContractor",
  menuisier: "GeneralContractor",
  peintre: "HousePainter",
  macon: "GeneralContractor",
  paysagiste: "HomeAndConstructionBusiness",
  autre: "LocalBusiness",
};

/** « Électricien à Villeurbanne | Nom » si ≤ 60 caractères, sinon on raccourcit. */
export function titreAccueil(): string {
  if (site.seo.titre) return site.seo.titre;
  const base = `${site.entreprise.metierLibelle} à ${site.zone.commune.nom}`;
  for (const t of [`${base} | ${nom}`, `${base} – ${nom}`, base]) if (t.length <= 60) return t;
  return base.slice(0, 60);
}

export function titrePage(page: string): string {
  const t = `${page} | ${nom}`;
  return t.length <= 60 ? t : page;
}

export function jsonLd(): Record<string, unknown> {
  const e = site.entreprise;
  const d: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": TYPE_SCHEMA[e.metier],
    name: nom,
    legalName: e.raisonSociale,
    telephone: tel.lien.replace("tel:", ""),
    address: {
      "@type": "PostalAddress",
      streetAddress: e.adresse.rue,
      postalCode: e.adresse.codePostal,
      addressLocality: e.adresse.commune,
      addressCountry: "FR",
    },
    areaServed: [site.zone.commune, ...site.zone.voisines].map((c) => ({ "@type": "City", name: c.nom })),
    description: site.seo.description,
  };
  if (site.seo.url) d.url = site.seo.url + "/";
  if (e.email) d.email = e.email;
  if (e.siret) d.identifier = { "@type": "PropertyValue", propertyID: "SIRET", value: e.siret.replace(/\s/g, "") };
  // Année seule : le site n'affiche jamais le jour ni le mois de création (règle des faits).
  if (e.dateCreation) d.foundingDate = e.dateCreation.slice(0, 4);
  if (site.zone.commune.lat !== undefined && site.zone.commune.lon !== undefined) {
    d.geo = { "@type": "GeoCoordinates", latitude: site.zone.commune.lat, longitude: site.zone.commune.lon };
  }
  const h = horairesSchemaOrg(e.horaires);
  if (h.length) d.openingHoursSpecification = h;
  // Uniquement si la note vient d'une source vérifiable ET qu'elle est affichée sur la page.
  if (e.noteGoogle && noteAffichee) {
    d.aggregateRating = { "@type": "AggregateRating", ratingValue: e.noteGoogle.valeur, reviewCount: e.noteGoogle.nombre, bestRating: 5 };
  }
  return d;
}
