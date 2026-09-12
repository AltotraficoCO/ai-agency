/**
 * Cuándo avisa la vigilancia y cuándo se calla.
 *
 * Es la regla que decide si se molesta a una persona, así que se prueba entera
 * sin red: un fallo aislado no es una caída, una caída se avisa una vez, y
 * volver a funcionar también es noticia.
 */
import { describe, expect, it } from "vitest";
import {
  decidirAvisos,
  tocaComprobacionDiaria,
  type Chequeo,
  type EstadoVigilancia,
} from "../src/vigilancia/decidir.js";

const T = (minutos: number): string => new Date(Date.UTC(2026, 8, 11, 10, minutos, 0)).toISOString();

const arriba = (en: string): Chequeo => ({
  en,
  portada: { ok: true, status: 200, ms: 320 },
  rest: { ok: true, credenciales: true },
});

const caida = (en: string, status: number | null = null): Chequeo => ({
  en,
  portada: { ok: false, status, ms: null, ...(status === null ? { error: "sin conexión" } : {}) },
});

describe("caída y recuperación", () => {
  it("un fallo aislado no avisa: queda en sospecha", () => {
    const { estado, avisos } = decidirAvisos({}, caida(T(0)));
    expect(avisos).toEqual([]);
    expect(estado.sospechaDesde).toBe(T(0));
    expect(estado.caido).toBeFalsy();
  });

  it("el segundo fallo seguido confirma la caída y avisa una vez", () => {
    const primera = decidirAvisos({}, caida(T(0)));
    const segunda = decidirAvisos(primera.estado, caida(T(15)));

    expect(segunda.estado.caido).toBe(true);
    expect(segunda.estado.caidoDesde).toBe(T(0));
    expect(segunda.avisos).toHaveLength(1);
    const aviso = segunda.avisos[0]!;
    expect(aviso.severidad).toBe("grave");
    expect(aviso.titulo).toContain("no está abriendo");
    expect(aviso.propuesta).toBeTruthy();
    // El texto es para el dueño del negocio: nada de jerga de servidores.
    expect(`${aviso.titulo} ${aviso.cuerpo}`).not.toMatch(/HTTP|5\d\d|timeout/i);
  });

  it("mientras sigue caído no se repite el aviso", () => {
    let estado: EstadoVigilancia = decidirAvisos({}, caida(T(0))).estado;
    estado = decidirAvisos(estado, caida(T(15))).estado;

    const tercera = decidirAvisos(estado, caida(T(30)));
    const cuarta = decidirAvisos(tercera.estado, caida(T(45)));

    expect(tercera.avisos).toEqual([]);
    expect(cuarta.avisos).toEqual([]);
    expect(cuarta.estado.caido).toBe(true);
  });

  it("cuando vuelve, avisa y cuenta cuánto estuvo sin abrir", () => {
    let estado: EstadoVigilancia = decidirAvisos({}, caida(T(0))).estado;
    estado = decidirAvisos(estado, caida(T(15))).estado;

    const vuelta = decidirAvisos(estado, arriba(T(75)));
    expect(vuelta.avisos).toHaveLength(1);
    expect(vuelta.avisos[0]!.severidad).toBe("bueno");
    expect(vuelta.avisos[0]!.cuerpo).toContain("1 hora");
    expect(vuelta.estado.caido).toBe(false);
    expect(vuelta.estado.caidoDesde).toBeUndefined();
  });

  it("una sospecha que se recupera sola no deja rastro ni avisa", () => {
    const primera = decidirAvisos({}, caida(T(0)));
    const segunda = decidirAvisos(primera.estado, arriba(T(15)));

    expect(segunda.avisos).toEqual([]);
    expect(segunda.estado.sospechaDesde).toBeUndefined();
  });

  it("un sitio sano no genera nada", () => {
    const { avisos } = decidirAvisos({}, arriba(T(0)));
    expect(avisos).toEqual([]);
  });
});

describe("credenciales", () => {
  const sinAcceso = (en: string): Chequeo => ({
    en,
    portada: { ok: true, status: 200, ms: 300 },
    rest: { ok: true, credenciales: false },
  });

  it("avisa una vez cuando deja de tener acceso, y no lo repite", () => {
    const primera = decidirAvisos({}, sinAcceso(T(0)));
    expect(primera.avisos).toHaveLength(1);
    expect(primera.avisos[0]!.titulo).toContain("Perdí el acceso");
    expect(primera.avisos[0]!.propuesta).toContain("Ajustes");

    const segunda = decidirAvisos(primera.estado, sinAcceso(T(15)));
    expect(segunda.avisos).toEqual([]);
  });

  it("avisa también cuando el acceso vuelve", () => {
    const primera = decidirAvisos({}, sinAcceso(T(0)));
    const vuelta = decidirAvisos(primera.estado, arriba(T(30)));
    expect(vuelta.avisos).toHaveLength(1);
    expect(vuelta.avisos[0]!.severidad).toBe("bueno");
  });

  it("con el sitio caído no se juzgan las credenciales", () => {
    const { avisos } = decidirAvisos({ caido: true, caidoDesde: T(0) }, caida(T(15)));
    expect(avisos).toEqual([]);
  });
});

describe("certificado", () => {
  const conCert = (en: string, diasRestantes: number): Chequeo => ({
    ...arriba(en),
    certificado: {
      diasRestantes,
      caducaEn: new Date(Date.UTC(2026, 8, 11 + diasRestantes)).toISOString(),
    },
  });

  it("callado mientras falta mucho", () => {
    const { avisos, estado } = decidirAvisos({}, conCert(T(0), 45));
    expect(avisos).toEqual([]);
    expect(estado.certMedidoEn).toBe(T(0));
  });

  it("avisa al entrar en los últimos quince días y no lo repite", () => {
    const primera = decidirAvisos({}, conCert(T(0), 14));
    expect(primera.avisos).toHaveLength(1);
    expect(primera.avisos[0]!.severidad).toBe("aviso");
    expect(primera.avisos[0]!.titulo).toContain("14 días");
    expect(primera.estado.certAvisado).toBe(15);

    const segunda = decidirAvisos(primera.estado, conCert(T(1440), 13));
    expect(segunda.avisos).toEqual([]);
  });

  it("vuelve a avisar al cruzar cada umbral, y grave cuando ya venció", () => {
    let estado = decidirAvisos({}, conCert(T(0), 14)).estado;
    const siete = decidirAvisos(estado, conCert(T(10_080), 6));
    expect(siete.avisos).toHaveLength(1);
    expect(siete.estado.certAvisado).toBe(7);

    estado = siete.estado;
    const vencido = decidirAvisos(estado, conCert(T(20_000), 0));
    expect(vencido.avisos).toHaveLength(1);
    expect(vencido.avisos[0]!.severidad).toBe("grave");
    expect(vencido.avisos[0]!.titulo).toContain("vencido");
  });

  it("si se renueva, el aviso queda rearmado para la próxima vez", () => {
    const avisado = decidirAvisos({}, conCert(T(0), 5)).estado;
    const renovado = decidirAvisos(avisado, conCert(T(1440), 90));
    expect(renovado.avisos).toEqual([]);
    expect(renovado.estado.certAvisado).toBeUndefined();
  });
});

describe("complementos y fallos de la página", () => {
  it("avisa de los complementos pendientes y espera una semana para recordarlo", () => {
    const chequeo = (en: string): Chequeo => ({
      ...arriba(en),
      plugins: { pendientes: 3, nombres: ["Elementor", "WooCommerce", "Yoast"] },
    });

    const primera = decidirAvisos({}, chequeo(T(0)));
    expect(primera.avisos).toHaveLength(1);
    expect(primera.avisos[0]!.cuerpo).toContain("Elementor");

    const alDiaSiguiente = decidirAvisos(primera.estado, chequeo(T(1440)));
    expect(alDiaSiguiente.avisos).toEqual([]);

    const aLaSemana = decidirAvisos(primera.estado, chequeo(T(60 * 24 * 8)));
    expect(aLaSemana.avisos).toHaveLength(1);
  });

  it("los fallos de la portada se cuentan en cristiano", () => {
    const { avisos } = decidirAvisos({}, { ...arriba(T(0)), consola: { errores: ["x is not defined"] } });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.cuerpo).toContain("botón");
    expect(avisos[0]!.cuerpo).not.toContain("x is not defined");
  });
});

describe("comprobaciones caras", () => {
  it("una vez al día basta", () => {
    expect(tocaComprobacionDiaria(undefined, T(0))).toBe(true);
    expect(tocaComprobacionDiaria(T(0), T(60))).toBe(false);
    expect(tocaComprobacionDiaria(T(0), T(1440))).toBe(true);
  });
});
