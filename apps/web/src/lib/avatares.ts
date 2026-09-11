/**
 * Las fotos de los agentes de WhatsApp.
 *
 * En WhatsApp no se contratan agentes: los crea la persona con Strap. Cada uno
 * recibe al crearse uno de estos personajes de plastilina, y se puede cambiar
 * desde sus instrucciones. Viven en `public/avatares/whatsapp/`.
 *
 * Dato puro, sin `"use client"` ni `server-only`: lo usan el selector (cliente)
 * y la publicación (servidor).
 */

export const AVATARES_WHATSAPP = [
  "/avatares/whatsapp/01.webp",
  "/avatares/whatsapp/02.webp",
  "/avatares/whatsapp/03.webp",
  "/avatares/whatsapp/04.webp",
  "/avatares/whatsapp/05.webp",
  "/avatares/whatsapp/06.webp",
  "/avatares/whatsapp/07.webp",
  "/avatares/whatsapp/08.webp",
  "/avatares/whatsapp/09.webp",
  "/avatares/whatsapp/10.webp",
] as const;

export type AvatarWhatsapp = (typeof AVATARES_WHATSAPP)[number];

/** La foto que se enseña cuando un agente todavía no tiene ninguna. */
export const AVATAR_POR_DEFECTO: AvatarWhatsapp = AVATARES_WHATSAPP[0];

export function esAvatarWhatsapp(ruta: unknown): ruta is AvatarWhatsapp {
  return typeof ruta === "string" && (AVATARES_WHATSAPP as readonly string[]).includes(ruta);
}

/**
 * Elige la foto de un agente nuevo.
 *
 * Prefiere una que el espacio todavía no use: dos agentes con la misma cara en
 * la misma pantalla se confunden. Si ya se usaron todas, cualquiera.
 */
export function elegirAvatar(usados: readonly (string | null)[], azar: () => number = Math.random): AvatarWhatsapp {
  const ocupados = new Set(usados.filter((u): u is string => typeof u === "string"));
  const libres = AVATARES_WHATSAPP.filter((ruta) => !ocupados.has(ruta));
  const opciones = libres.length > 0 ? libres : AVATARES_WHATSAPP;
  return opciones[Math.floor(azar() * opciones.length)] ?? AVATAR_POR_DEFECTO;
}
