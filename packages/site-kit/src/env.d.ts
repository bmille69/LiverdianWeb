/// <reference types="astro/client" />

declare module "virtual:liverdian/polices" {
  /** Déclarations @font-face des polices du thème et de leurs replis ajustés. */
  export const css: string;
  /** URLs des fichiers woff2 à précharger. */
  export const precharges: string[];
}
