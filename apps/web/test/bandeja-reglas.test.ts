import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  esUrgente,
  ordenarElementos,
  puedeEscribir,
  rellenarVariables,
  PALETA_ETIQUETAS,
  type ElementoHilo,
} from "../src/lib/bandeja/tipos";
import { quienHabla, resolverMando } from "../src/lib/bandeja/consultas";

describe("quién manda", () => {
  const base = { handover_state: "bot", bot_enabled: true, bot_paused_until: null, assignee_user_id: null };

  it("con el bot activo, manda la IA", () => {
    expect(resolverMando(base, "yo")).toBe("ia");
  });

  it("con el control humano y asignado a mí, mando yo", () => {
    expect(resolverMando({ ...base, handover_state: "human", assignee_user_id: "yo" }, "yo")).toBe("tuyo");
  });

  it("con el control humano y asignado a otro, manda esa persona", () => {
    expect(resolverMando({ ...base, handover_state: "human", assignee_user_id: "ana" }, "yo")).toBe("otro");
  });

  it("una pausa vigente deja a nadie al mando", () => {
    const dentroDeUnaHora = new Date(Date.now() + 3_600_000).toISOString();
    expect(resolverMando({ ...base, bot_paused_until: dentroDeUnaHora }, "yo")).toBe("pausado");
  });

  it("una pausa vencida devuelve la palabra a la IA", () => {
    const haceUnaHora = new Date(Date.now() - 3_600_000).toISOString();
    expect(resolverMando({ ...base, bot_paused_until: haceUnaHora }, "yo")).toBe("ia");
  });
});

describe("quién habla (el color de la burbuja sale de aquí)", () => {
  it("distingue cliente, IA, humano y sistema", () => {
    expect(quienHabla("inbound", "contact")).toBe("cliente");
    expect(quienHabla("outbound", "bot")).toBe("ia");
    expect(quienHabla("outbound", "human")).toBe("humano");
    expect(quienHabla("outbound", "system")).toBe("sistema");
  });
});

describe("permiso para escribir", () => {
  it("la IA atendiendo bloquea, y el motivo es el mando", () => {
    expect(puedeEscribir({ mando: "ia", envioPermitido: true })).toEqual({
      permitido: false,
      motivo: "mando",
    });
  });

  it("con el mando tuyo pero el canal cerrado, el motivo es el canal", () => {
    expect(puedeEscribir({ mando: "tuyo", envioPermitido: false })).toEqual({
      permitido: false,
      motivo: "canal",
    });
  });

  it("solo se escribe con las dos condiciones", () => {
    expect(puedeEscribir({ mando: "tuyo", envioPermitido: true }).permitido).toBe(true);
  });
});

describe("orden del hilo", () => {
  const mensaje = (id: string, fecha: string, quien: "cliente" | "ia"): ElementoHilo => ({
    clase: "mensaje",
    id,
    quien,
    texto: id,
    tipo: "text",
    fecha,
    estado: "sent",
    autor: null,
    error: null,
  });

  it("ordena por fecha", () => {
    const orden = ordenarElementos([
      mensaje("b", "2026-08-27T10:05:00Z", "ia"),
      mensaje("a", "2026-08-27T10:00:00Z", "cliente"),
    ]).map((e) => e.id);
    expect(orden).toEqual(["a", "b"]);
  });

  it("a la misma hora, la pregunta va antes que la respuesta", () => {
    // El caso real: el entrante y la respuesta del agente se escriben en la
    // MISMA transacción, así que `now()` les da el mismo instante. Sin desempate
    // el hilo enseñaría la respuesta antes que la pregunta.
    const misma = "2026-08-27T10:00:00Z";
    const orden = ordenarElementos([
      mensaje("respuesta", misma, "ia"),
      mensaje("pregunta", misma, "cliente"),
    ]).map((e) => e.id);
    expect(orden).toEqual(["pregunta", "respuesta"]);
  });

  it("mezcla notas y eventos en el mismo orden temporal", () => {
    const orden = ordenarElementos([
      mensaje("m2", "2026-08-27T10:10:00Z", "ia"),
      { clase: "nota", id: "n1", texto: "ojo", fecha: "2026-08-27T10:05:00Z", autor: null, menciones: [] },
      mensaje("m1", "2026-08-27T10:00:00Z", "cliente"),
    ]).map((e) => e.id);
    expect(orden).toEqual(["m1", "n1", "m2"]);
  });
});

describe("acuerdo de servicio", () => {
  const ahora = new Date("2026-08-27T12:00:00Z");

  it("marca urgente lo que lleva más del límite sin respuesta", () => {
    expect(
      esUrgente({ ultimoEntrante: "2026-08-27T11:00:00Z", ultimoSaliente: null, estado: "open" }, ahora),
    ).toBe(true);
  });

  it("no marca lo que ya se contestó", () => {
    expect(
      esUrgente(
        { ultimoEntrante: "2026-08-27T11:00:00Z", ultimoSaliente: "2026-08-27T11:30:00Z", estado: "open" },
        ahora,
      ),
    ).toBe(false);
  });

  it("no marca lo que está dentro del límite", () => {
    expect(
      esUrgente({ ultimoEntrante: "2026-08-27T11:50:00Z", ultimoSaliente: null, estado: "open" }, ahora),
    ).toBe(false);
  });

  it("no marca lo cerrado ni lo pospuesto", () => {
    expect(
      esUrgente({ ultimoEntrante: "2026-08-27T01:00:00Z", ultimoSaliente: null, estado: "snoozed" }, ahora),
    ).toBe(false);
  });
});

describe("respuestas rápidas", () => {
  it("rellena las variables conocidas", () => {
    expect(rellenarVariables("Hola {{contacto.nombre}}", { "contacto.nombre": "Marcela" })).toBe(
      "Hola Marcela",
    );
  });

  it("deja la variable a la vista cuando no hay dato, en vez de dejar un hueco", () => {
    // Enviar «Hola ,» al cliente es peor que enviar algo que se ve mal en el
    // composer y se corrige antes de mandarlo.
    expect(rellenarVariables("Hola {{contacto.nombre}}", {})).toBe("Hola {{contacto.nombre}}");
  });
});

describe("paleta de etiquetas", () => {
  it("son ocho neutros teñidos y ninguno es un color semántico", () => {
    expect(PALETA_ETIQUETAS).toHaveLength(8);
    const semanticos = ["#EF4444", "#DC2626", "#22C55E", "#16A34A", "#F0A511", "#3B82F6"];
    for (const color of PALETA_ETIQUETAS) {
      expect(semanticos).not.toContain(color.hex.toUpperCase());
    }
  });
});

/**
 * La nota interna nunca llega al cliente.
 *
 * Se afirma sobre el código, no sobre una ejecución: lo que garantiza el
 * invariante es que la función que guarda notas no tiene ninguna forma de
 * escribir en `messages`, y eso se puede comprobar sin base de datos. Si
 * alguien «unifica» las dos funciones en una con un booleano, este test cae.
 */
describe("una nota interna no puede acabar en WhatsApp", () => {
  const fuente = readFileSync(
    fileURLToPath(new URL("../src/lib/bandeja/acciones.ts", import.meta.url)),
    "utf8",
  );

  const cuerpoDe = (nombre: string): string => {
    const inicio = fuente.indexOf(`export async function ${nombre}`);
    expect(inicio).toBeGreaterThan(-1);
    const siguiente = fuente.indexOf("\nexport ", inicio + 1);
    return fuente.slice(inicio, siguiente === -1 ? undefined : siguiente);
  };

  it("crearNota solo escribe en la tabla de notas", () => {
    const cuerpo = cuerpoDe("crearNota");
    expect(cuerpo).toContain("insert into public.notes");
    expect(cuerpo).not.toContain("public.messages");
  });

  it("enviarAlCliente comprueba el mando y la política del canal antes de escribir", () => {
    const cuerpo = cuerpoDe("enviarAlCliente");
    expect(cuerpo).toContain("resolverMando");
    expect(cuerpo).toContain("politicaDeEnvio");
    expect(cuerpo).toContain("insert into public.messages");
  });

  it("la ruta de mensajes no sabe crear notas", () => {
    const ruta = readFileSync(
      fileURLToPath(
        new URL("../src/app/api/bandeja/conversaciones/[id]/mensajes/route.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(ruta).toContain("enviarAlCliente");
    expect(ruta).not.toContain("crearNota");
  });
});
