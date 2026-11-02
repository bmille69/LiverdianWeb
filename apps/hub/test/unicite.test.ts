import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { SiteKit } from "../src/atelier/kit.ts";
import { motsDe, textesDe } from "../src/atelier/registre.ts";
import { ENTETES, MISE, PAIRES_POLICES, PALETTE, PIEDS, POLICES, SIGNATURES, VARIANTES } from "../src/atelier/schemas.ts";
import { distanceDesign, distanceKm, elementsProches, normaliserTexte, passagesCommuns, shingles, similariteTexte, verifierUnicite, type Empreinte, type SeuilsUnicite } from "../src/atelier/unicite.ts";

const KIT = join(import.meta.dirname, "..", "..", "..", "packages", "site-kit");

const BASE: Empreinte = {
  nom: "Lumen Élec",
  metier: "electricien",
  commune: "Bron",
  lat: 45.7386,
  lon: 4.9131,
  preset: "electricien",
  couleurs: { accent: "#E59A62", sombre: "#1A1C22", fond: "#F6F3EE" },
  polices: { titres: "space-grotesk", corps: "source-sans-3" },
  paire: "plan-de-coupe",
  rayon: 2,
  signature: "faisceau",
  mise: { echelle: "equilibree", densite: "standard", images: "naturel", cadre: "equerres", boutons: "plein", rythme: "alterne", titres: "normale", surtitres: "marqueur" },
  entete: "simple",
  pied: "complet",
  sections: ["hero:scinde", "services:liste", "realisations:grille", "zone:carte", "devis:encadre"],
  heroImage: "stock/electricien/a.jpg",
  images: ["stock/electricien/a.jpg"],
  surMesure: null,
  titres: [],
  phrases: [],
  remplacements: { nom: ["Lumen Élec"], communes: ["Bron"] },
};

/** Un site qui diffère sur tous les axes. */
const AUTRE: Empreinte = {
  ...BASE,
  nom: "Volt Est",
  commune: "Vénissieux",
  lat: 45.697,
  lon: 4.886,
  couleurs: { accent: "#2E6FD8", sombre: "#2B1830", fond: "#FFFFFF" },
  polices: { titres: "fraunces", corps: "work-sans" },
  paire: "artisan-d-art",
  rayon: 16,
  signature: "tuiles",
  mise: { echelle: "monumentale", densite: "aeree", images: "duotone", cadre: "arche", boutons: "marque", rythme: "contraste", titres: "capitales", surtitres: "pastille" },
  entete: "centre",
  pied: "signature",
  sections: ["hero:typo", "pourquoi:etapes", "services:tuiles", "zone:bandeau", "surmesure:composant", "devis:appel"],
  heroImage: null,
};

const SEUILS: SeuilsUnicite = { zoneKm: 30, distanceVoisin: 0.55, distanceMetier: 0.45, distanceZone: 0.35, texteMetier: 0.04, texteAutre: 0.06, teinteVoisin: 25 };

describe("distance de design", () => {
  it("0 entre deux empreintes identiques, proche de 1 quand tout diffère", () => {
    expect(distanceDesign(BASE, BASE)).toBe(0);
    expect(distanceDesign(BASE, AUTRE)).toBeGreaterThan(0.9);
    // Symétrique.
    expect(distanceDesign(BASE, AUTRE)).toBe(distanceDesign(AUTRE, BASE));
  });

  it("dit ce qui est trop proche, mot pour mot", () => {
    const presque = { ...BASE, couleurs: { ...BASE.couleurs, accent: "#E8A06A" } };
    const e = elementsProches(presque, BASE);
    expect(e).toContain("même police des titres : space-grotesk");
    expect(e).toContain("même variante du hero : hero:scinde");
    expect(e.some((x) => x.startsWith("presque même couleur d'accent : #E8A06A contre #E59A62"))).toBe(true);
  });

  it("distance à vol d'oiseau entre communes", () => {
    expect(distanceKm(BASE, { lat: 45.7719, lon: 4.8902 })).toBeCloseTo(4.1, 0);
    expect(distanceKm(BASE, { lat: null, lon: null })).toBeNull();
  });
});

describe("similarité de texte", () => {
  it("neutralise le nom de l'entreprise et les communes : une phrase recyclée est repérée", () => {
    const a = normaliserTexte(["Votre électricien à Bron, du tableau au luminaire, chez Lumen Élec."], { nom: ["Lumen Élec"], communes: ["Bron"] });
    const b = normaliserTexte(["Votre électricien à Vénissieux, du tableau au luminaire, chez Volt Est."], { nom: ["Volt Est"], communes: ["Vénissieux"] });
    expect(similariteTexte(shingles(a), shingles(b))).toBe(1);
    expect(passagesCommuns(a, shingles(b))[0]).toBe("votre électricien à jcommune du tableau au luminaire chez jnom");
  });

  it("mot entier seulement, et une liste de communes n'est pas une phrase", () => {
    expect(normaliserTexte(["Pose de bronze à Bron"], { nom: [], communes: ["Bron"] })).toEqual(["pose", "de", "bronze", "à", "jcommune", "¶"]);
    const liste = normaliserTexte(["Bron, Villeurbanne, Vaulx-en-Velin, Chassieu et Lyon 8e"], { nom: [], communes: ["Bron", "Villeurbanne", "Vaulx-en-Velin", "Chassieu", "Lyon 8e"] });
    expect(shingles(liste).size).toBe(0);
  });

  it("deux textes différents restent sous le seuil", () => {
    const a = shingles(normaliserTexte(["Un disjoncteur qui saute sans raison apparente mérite un diagnostic complet du tableau."], { nom: [], communes: [] }));
    const b = shingles(normaliserTexte(["Nous refaisons les installations anciennes pièce par pièce, en gardant vos murs propres."], { nom: [], communes: [] }));
    expect(similariteTexte(a, b)).toBe(0);
  });
});

describe("contrôle d'unicité", () => {
  const autre = (e: Empreinte, mots: string[] = []) => ({ id: "x", nom: e.nom, commune: e.commune, origine: "maquette", empreinte: e, mots });

  it("même métier dans la zone : design trop proche → Directeur artistique, avec les éléments en cause", () => {
    const v = verifierUnicite({ ...BASE, nom: "Moi", heroImage: "stock/electricien/b.jpg" }, [], [autre(BASE)], SEUILS);
    expect(v.ok).toBe(false);
    expect(v.comparaisons[0]).toMatchObject({ relation: "voisin", seuilDistance: 0.55 });
    const c = v.conflits.find((x) => x.agent === "directeur-artistique")!;
    expect(c.details.join("\n")).toMatch(/même paire de polices que Lumen Élec/);
    expect(c.details.join("\n")).toMatch(/teinte d'accent trop proche/);
    expect(c.details.join("\n")).toMatch(/distance de design 0\.\d+ avec Lumen Élec .*minimum 0.55/);
  });

  it("photo de hero déjà employée par un site de la zone : refus, même pour un autre métier", () => {
    const plombier = { ...AUTRE, metier: "plombier", heroImage: "stock/electricien/a.jpg" };
    const v = verifierUnicite(BASE, [], [autre(plombier)], SEUILS);
    expect(v.comparaisons[0]!.relation).toBe("zone");
    expect(v.conflits[0]!.details[0]).toMatch(/même photo de hero/);
  });

  it("texte recyclé → Rédacteur, avec les passages verbatim ; un site loin d'un autre métier ne compte pas pour le design", () => {
    const textes = ["Votre électricien à Bron, du tableau au luminaire, sans mauvaise surprise sur la facture."];
    const mien = normaliserTexte(textes, { nom: [], communes: ["Bron"] });
    const loin = { ...AUTRE, metier: "couvreur", lat: 45.4, lon: 4.87 };
    const v = verifierUnicite(BASE, mien, [autre(loin, normaliserTexte(textes.map((t) => t.replace("Bron", "Vienne")), { nom: [], communes: ["Vienne"] }))], SEUILS);
    expect(v.comparaisons[0]).toMatchObject({ relation: "autre", seuilDistance: null });
    expect(v.conflits).toHaveLength(1);
    expect(v.conflits[0]!.agent).toBe("redacteur");
    expect(v.conflits[0]!.details.join("\n")).toContain("passage déjà employé : « votre électricien à jcommune du tableau au luminaire sans mauvaise surprise sur la facture »");
  });

  it("un site franchement différent passe, et le plus proche est rapporté", () => {
    const v = verifierUnicite(BASE, [], [autre(AUTRE)], SEUILS);
    expect(v.ok).toBe(true);
    expect(v.plusProche?.nom).toBe("Volt Est");
  });
});

describe("registre : textes et empreinte d'un vrai site", () => {
  it("empreinte de l'exemple du kit (palette, polices, variantes, photo du hero) et textes écrits", async () => {
    const { Registre } = await import("../src/atelier/registre.ts");
    const site = (await import(pathToFileURL(join(KIT, "examples", "electricien-villeurbanne", "site.json")).href, { with: { type: "json" } })).default;
    const reg = new Registre({ db: null as never, kit: new SiteKit(KIT), sites: null as never });
    const e = await reg.empreinte(site);
    expect(e.metier).toBe("electricien");
    expect(e.commune).toBe("Villeurbanne");
    expect(e.lat).toBeTypeOf("number");
    expect(e.couleurs.accent).toMatch(/^#[0-9A-F]{6}$/i);
    expect(e.sections[0]).toMatch(/^hero:/);
    expect(e.heroImage).toMatch(/^stock\//);
    expect(e.mise.cadre).not.toBe("auto");
    expect(textesDe(site).titres.length).toBeGreaterThan(5);
    expect(motsDe(site)).toContain("jcommune");
  });
});

describe("le hub et le kit parlent du même catalogue", () => {
  it("listes du hub identiques à celles du kit, et chaque variante décrite pour le DA", async () => {
    const k = await import(pathToFileURL(join(KIT, "src", "schema.ts")).href);
    expect([...POLICES]).toEqual([...k.POLICES]);
    expect([...PAIRES_POLICES]).toEqual([...k.PAIRES_POLICES]);
    expect([...SIGNATURES]).toEqual([...k.SIGNATURES]);
    expect([...ENTETES]).toEqual([...k.ENTETES]);
    expect([...PIEDS]).toEqual([...k.PIEDS]);
    expect(JSON.parse(JSON.stringify(MISE))).toEqual(JSON.parse(JSON.stringify(k.MISE)));
    expect(JSON.parse(JSON.stringify(PALETTE))).toEqual(JSON.parse(JSON.stringify(k.PALETTE)));
    for (const [t, v] of Object.entries(k.VARIANTES as Record<string, string[]>)) expect(VARIANTES[t as keyof typeof VARIANTES]).toEqual([...v]);
    const cat = await new SiteKit(KIT).catalogue();
    for (const [t, v] of Object.entries(k.VARIANTES as Record<string, string[]>)) for (const x of v) expect(cat.variantes[t]?.[x], `${t}:${x}`).toBeTruthy();
    expect(Object.keys(cat.paires)).toHaveLength(PAIRES_POLICES.length);
    expect(PAIRES_POLICES.length).toBeGreaterThanOrEqual(16);
  });

  it("toutes les palettes générées respectent les contrastes AA du kit", async () => {
    const { genererPalette } = await import(pathToFileURL(join(KIT, "src", "lib", "palette.ts")).href);
    const { verifierContrastes } = await import(pathToFileURL(join(KIT, "src", "lib", "theme.ts")).href);
    let n = 0;
    for (let teinte = 0; teinte < 360; teinte += 45)
      for (let accent = 0; accent < 360; accent += 30)
        for (const accentTon of PALETTE.accentTon)
          for (const sombre of PALETTE.sombre)
            for (const fond of PALETTE.fond) {
              expect(verifierContrastes(genererPalette({ teinte, accent, accentTon, sombre, fond, vivacite: "vive", neutres: "colores" }))).toEqual([]);
              n++;
            }
    expect(n).toBeGreaterThan(1000);
  });
});

describe("séries de photos, idée sur mesure et piste de départ", () => {
  it("deux photos de la même série comptent comme la même photo de hero ; même idée sur mesure refusée entre voisins", async () => {
    const { seriePhoto } = await import("../src/atelier/unicite.ts");
    expect(seriePhoto("stock/electricien/boites-encastrement-02.jpg")).toBe("stock/electricien/boites-encastrement.jpg");
    const voisin = { ...AUTRE, metier: "electricien", heroImage: "stock/electricien/boites-encastrement-01.jpg", surMesure: { composant: "A", element: "Tableau électrique annoté (lecture d'une mise en sécurité)" } };
    const moi = { ...BASE, heroImage: "stock/electricien/boites-encastrement-02.jpg", surMesure: { composant: "B", element: "Tableau électrique annoté : ce que l'on vérifie" } };
    const v = verifierUnicite(moi, [], [{ id: "x", nom: "Volt Est", commune: "Vénissieux", origine: "maquette", empreinte: voisin, mots: [] }], SEUILS);
    const details = v.conflits.flatMap((c) => c.details).join("\n");
    expect(details).toMatch(/même photo de hero \(ou même série\)/);
    expect(details).toMatch(/même idée d'élément sur mesure/);
  });

  it("piste de départ : reproductible pour un site, différente d'un site à l'autre, et loin des choix des voisins", async () => {
    const { pisteDeDepart } = await import("../src/atelier/piste.ts");
    expect(pisteDeDepart("site-a", [BASE])).toEqual(pisteDeDepart("site-a", [BASE]));
    const pistes = Array.from({ length: 40 }, (_, i) => pisteDeDepart(`site-${i}`, [BASE]));
    expect(new Set(pistes.map((p) => `${p.hero}|${p.sections.services}|${p.paire}|${p.signature}`)).size).toBeGreaterThan(30);
    // BASE emploie hero:scinde et la paire plan-de-coupe : rarement tirés.
    expect(pistes.filter((p) => p.hero === "scinde").length).toBeLessThan(6);
    expect(pistes.filter((p) => p.paire === "plan-de-coupe").length).toBeLessThan(3);
    // Accent éloigné de celui du voisin (#E59A62, ≈ 55°).
    for (const p of pistes) expect(Math.min(Math.abs(p.palette.accent - 55), 360 - Math.abs(p.palette.accent - 55))).toBeGreaterThan(60);
  });
});
