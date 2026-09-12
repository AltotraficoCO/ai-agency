/**
 * Lo que se guarda aquí lo lee el worker para escribirle al cliente por
 * WhatsApp, y cada mensaje se lo cobra Meta a él. Un número mal normalizado o
 * unos avisos encendidos sin plantilla aprobada no fallan en esta pantalla:
 * fallan el día que se cae la web y nadie se entera.
 */
import { describe, expect, it } from "vitest";
import {
  IDIOMA_POR_DEFECTO,
  normalizarIdioma,
  normalizarNumero,
  normalizarPlantilla,
  puedeActivarse,
} from "../src/lib/avisos/formato";

describe("el número al que se avisa", () => {
  it("acepta cómo lo escribe una persona y lo deja como lo quiere WhatsApp", () => {
    expect(normalizarNumero("+57 300 123 4567")).toBe("573001234567");
    expect(normalizarNumero("(300) 123-4567")).toBe("3001234567");
  });

  it("rechaza lo que no puede ser un número", () => {
    expect(normalizarNumero("")).toBeNull();
    expect(normalizarNumero("12345")).toBeNull();
    expect(normalizarNumero("mi whatsapp")).toBeNull();
    // Más de 15 dígitos no existe en el estándar internacional.
    expect(normalizarNumero("1234567890123456")).toBeNull();
  });
});

describe("el nombre de la plantilla", () => {
  it("se guarda como lo nombra Meta: minúsculas y guiones bajos", () => {
    expect(normalizarPlantilla("Aviso_Del_Sitio")).toBe("aviso_del_sitio");
    expect(normalizarPlantilla("  aviso_del_sitio  ")).toBe("aviso_del_sitio");
  });

  it("rechaza lo que Meta no aceptaría", () => {
    expect(normalizarPlantilla("aviso del sitio")).toBeNull();
    expect(normalizarPlantilla("avisó")).toBeNull();
    expect(normalizarPlantilla("")).toBeNull();
  });
});

describe("el idioma", () => {
  it("admite es y es_CO, y usa es cuando se deja vacío", () => {
    expect(normalizarIdioma("es")).toBe("es");
    expect(normalizarIdioma("es_CO")).toBe("es_CO");
    expect(normalizarIdioma("")).toBe(IDIOMA_POR_DEFECTO);
  });

  it("rechaza lo que no es un código de idioma", () => {
    expect(normalizarIdioma("español")).toBeNull();
    expect(normalizarIdioma("es-CO")).toBeNull();
  });
});

describe("encender los avisos", () => {
  it("no se puede sin plantilla aprobada", () => {
    // Meta no deja que un negocio escriba primero sin una plantilla suya, así
    // que encenderlos sin ella sería prometer avisos que nunca saldrían.
    expect(puedeActivarse({ destino: "573001234567", plantilla: "" })).toBe(false);
    expect(puedeActivarse({ destino: "573001234567", plantilla: null })).toBe(false);
  });

  it("tampoco sin número", () => {
    expect(puedeActivarse({ destino: "", plantilla: "aviso_del_sitio" })).toBe(false);
  });

  it("con los dos, sí", () => {
    expect(puedeActivarse({ destino: "573001234567", plantilla: "aviso_del_sitio" })).toBe(true);
  });
});
