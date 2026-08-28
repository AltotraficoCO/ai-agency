/**
 * Doble del contrato estándar del conector (sitios propios, no WordPress).
 *
 * Igual que el de WordPress: estado en memoria, mismas rutas, mismas formas.
 * Declara capacidades porque el contrato dice que el sitio manda: el agente
 * solo puede hacer lo que el sitio declare, y eso hay que poder probarlo.
 */
import type { Bloque, InfoConector, Pagina } from "../conector/client.js";

export const BASE_CONECTOR = "https://propio.test/api/strappy/v1";

export type EstadoConector = {
  token: string;
  info: InfoConector;
  paginas: Pagina[];
  ajustes: Record<string, unknown>;
  publicaciones: number;
};

export type DobleConector = {
  readonly estado: EstadoConector;
  readonly fetch: typeof globalThis.fetch;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function crearDobleConector(parcial: Partial<EstadoConector> = {}): DobleConector {
  const estado: EstadoConector = {
    token: "tok_de_prueba",
    info: {
      conector: "@strappy/connector",
      version: "1.0.0",
      contrato: 1,
      sitio: { nombre: "Estudio Ribera", url: "https://propio.test" },
      capacidades: ["paginas_leer", "paginas_escribir", "ajustes_escribir", "publicar"],
    },
    paginas: [
      {
        id: "inicio",
        titulo: "Inicio",
        ruta: "/",
        status: "publicada",
        secciones: [
          { id: "s1", tipo: "hero", props: { titulo: "Diseñamos espacios" } },
          { id: "s2", tipo: "texto", props: { html: "<p>Desde 2011.</p>" } },
        ],
      },
    ],
    ajustes: { titulo: "Estudio Ribera", telefono: "600 000 000" },
    publicaciones: 0,
    ...parcial,
  };

  const fetchDoble: typeof globalThis.fetch = async (entrada, init) => {
    const url = new URL(typeof entrada === "string" ? entrada : String(entrada));
    const ruta = url.pathname.replace("/api/strappy/v1", "");
    const metodo = (init?.method ?? "GET").toUpperCase();
    const crudas = (init as RequestInit | undefined)?.headers;
    const headers = new Headers((crudas ?? {}) as Record<string, string>);
    if (headers.get("authorization") !== `Bearer ${estado.token}`) {
      return json({ error: "token inválido" }, 401);
    }
    const cuerpo = (): Record<string, unknown> =>
      init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (ruta === "/info") return json(estado.info);
    if (ruta === "/publicar") {
      estado.publicaciones += 1;
      return json({ ok: true, detalle: "revalidado" });
    }
    if (ruta === "/ajustes") {
      if (metodo === "PUT") {
        Object.assign(estado.ajustes, cuerpo());
        return json({ ok: true });
      }
      return json(estado.ajustes);
    }
    if (ruta === "/paginas") {
      if (metodo === "POST") {
        const b = cuerpo();
        const nueva: Pagina = {
          id: `p_${estado.paginas.length + 1}`,
          titulo: String(b.titulo ?? ""),
          ruta: String(b.ruta ?? "/nueva"),
          status: String(b.status ?? "publicada"),
          secciones: (b.secciones as Bloque[]) ?? [],
        };
        estado.paginas.push(nueva);
        return json({ id: nueva.id, url: `https://propio.test${nueva.ruta}` }, 201);
      }
      return json(estado.paginas.map(({ secciones: _s, ...r }) => r));
    }

    const seccion = /^\/paginas\/([^/]+)\/secciones\/([^/]+)$/.exec(ruta);
    if (seccion) {
      const p = estado.paginas.find((x) => x.id === decodeURIComponent(seccion[1]!));
      const s = p?.secciones.find((x) => x.id === decodeURIComponent(seccion[2]!));
      if (!s) return json({ error: "sección no encontrada" }, 404);
      const b = cuerpo();
      if (b.tipo) s.tipo = String(b.tipo);
      if (b.props) Object.assign(s.props, b.props as Record<string, unknown>);
      return json({ ok: true });
    }

    const item = /^\/paginas\/([^/]+)$/.exec(ruta);
    if (item) {
      const id = decodeURIComponent(item[1]!);
      const i = estado.paginas.findIndex((x) => x.id === id);
      const p = estado.paginas[i];
      if (!p) return json({ error: "página no encontrada" }, 404);
      if (metodo === "PUT") {
        const b = cuerpo();
        if (b.titulo !== undefined) p.titulo = String(b.titulo);
        if (b.status !== undefined) p.status = String(b.status);
        if (b.secciones !== undefined) p.secciones = b.secciones as Bloque[];
        return json({ ok: true });
      }
      if (metodo === "DELETE") {
        estado.paginas.splice(i, 1);
        return json({ ok: true });
      }
      return json(p);
    }

    return json({ error: `ruta desconocida ${ruta}` }, 404);
  };

  return { estado, fetch: fetchDoble };
}
