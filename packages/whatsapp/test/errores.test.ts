import { describe, expect, it } from "vitest";
import { decidirPorCodigo, decidirPorRespuesta } from "../src/errors.js";
import { fixture } from "./fixtures.js";

describe("mapeo de códigos de Meta a decisiones", () => {
  it("131047 (fuera de ventana): no se reintenta, hace falta plantilla", () => {
    const d = decidirPorCodigo(131047);
    expect(d.accion).toBe("requiere_plantilla");
    expect(d.reintentar).toBe(false);
    expect(d.pausarCola).toBe(false);
    expect(d.marcarCuentaRevocada).toBe(false);
    expect(d.mensajeUsuario).toContain("plantilla aprobada");
  });

  it("130429 (límite de tasa): se reintenta con espera", () => {
    const d = decidirPorCodigo(130429);
    expect(d.accion).toBe("reintentar");
    expect(d.reintentar).toBe(true);
    expect(d.esperaSugeridaMs).toBeGreaterThan(0);
    expect(d.pausarCola).toBe(false);
  });

  it("132000 y 132001 (plantilla): no se reintentan", () => {
    for (const codigo of [132000, 132001]) {
      const d = decidirPorCodigo(codigo);
      expect(d.accion).toBe("descartar");
      expect(d.reintentar).toBe(false);
      expect(d.marcarCuentaRevocada).toBe(false);
    }
  });

  it("190 (token): marca la cuenta revocada y pausa la cola de ese cliente", () => {
    const d = decidirPorCodigo(190);
    expect(d.accion).toBe("token_revocado");
    expect(d.marcarCuentaRevocada).toBe(true);
    expect(d.pausarCola).toBe(true);
    expect(d.reintentar).toBe(false);
  });

  it("131031 (cuenta bloqueada): pausa la cola pero no revoca el token", () => {
    const d = decidirPorCodigo(131031);
    expect(d.pausarCola).toBe(true);
    expect(d.marcarCuentaRevocada).toBe(false);
    expect(d.reintentar).toBe(false);
  });

  it("los 5xx de Meta se reintentan", () => {
    expect(decidirPorCodigo(1).reintentar).toBe(true);
    expect(decidirPorCodigo(2).reintentar).toBe(true);
    expect(decidirPorCodigo(131000).reintentar).toBe(true);
  });

  it("un 132xxx desconocido cae en la familia de plantillas y no se reintenta", () => {
    const d = decidirPorCodigo(132099);
    expect(d.accion).toBe("descartar");
    expect(d.reintentar).toBe(false);
  });

  it("un 133xxx desconocido pausa la cola: es un problema de registro del número", () => {
    expect(decidirPorCodigo(133099).pausarCola).toBe(true);
  });

  it("un código totalmente desconocido se descarta y se registra", () => {
    const d = decidirPorCodigo(999999);
    expect(d.reintentar).toBe(false);
    expect(d.accion).toBe("descartar");
  });

  it("todo mensaje al usuario va en español", () => {
    for (const codigo of [131047, 130429, 132000, 132001, 190, 131031, 133010, 4]) {
      const { mensajeUsuario } = decidirPorCodigo(codigo);
      expect(mensajeUsuario.length).toBeGreaterThan(10);
      expect(mensajeUsuario).not.toMatch(/[a-z]+ing\b|failed|error validating/i);
    }
  });
});

describe("decisiones a partir de respuestas grabadas de Meta", () => {
  it("cuerpo de error 131047", () => {
    const d = decidirPorRespuesta(fixture("error-131047"), 400);
    expect(d.code).toBe(131047);
    expect(d.subcode).toBe(2494010);
    expect(d.accion).toBe("requiere_plantilla");
  });

  it("cuerpo de error 130429", () => {
    expect(decidirPorRespuesta(fixture("error-130429"), 400).reintentar).toBe(true);
  });

  it("cuerpo de error 132001", () => {
    expect(decidirPorRespuesta(fixture("error-132001"), 400).reintentar).toBe(false);
  });

  it("cuerpo de error 190", () => {
    const d = decidirPorRespuesta(fixture("error-190"), 401);
    expect(d.marcarCuentaRevocada).toBe(true);
    expect(d.pausarCola).toBe(true);
  });

  it("sin cuerpo interpretable decide por el estado HTTP", () => {
    expect(decidirPorRespuesta(null, 429).reintentar).toBe(true);
    expect(decidirPorRespuesta(null, 503).reintentar).toBe(true);
    expect(decidirPorRespuesta(null, 401).marcarCuentaRevocada).toBe(true);
    expect(decidirPorRespuesta("<html>502</html>", 400).reintentar).toBe(false);
  });
});
