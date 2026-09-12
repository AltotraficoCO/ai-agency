/**
 * Dobles de los puertos del Diseñador.
 *
 * Existen para poder probar el agente ENTERO sin gastar un crédito en un modelo
 * de imagen y sin tocar el sitio de nadie. Cuando el adaptador real cambie de
 * proveedor, rellena la misma interfaz y estos tests siguen valiendo.
 */
import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
  EstiloDeMarca,
  ImagenGenerada,
  ImagenesPort,
  Medida,
  MedioBreve,
  MediosPort,
} from "../ports.js";

/** Un PNG de 1x1 real: sirve para comprobar que los bytes viajan enteros. */
export const PNG_MINIMO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const ESTILO_DE_EJEMPLO: EstiloDeMarca = {
  origen: "sitio",
  colores: {
    primario: "#123A59",
    acento: "#D09E1D",
    texto: "#124559",
    fondo: "#FFFFFF",
    oscuro: "#123A59",
  },
  tipografia: { titulos: "Roboto", cuerpo: "Roboto" },
  referencia: "/",
};

export class ImagenesEnMemoria implements ImagenesPort {
  readonly modelo = "doble/imagen";
  readonly llamadas: { prompt: string; medida: Medida }[] = [];
  /** Para probar el camino de error del proveedor. */
  falla = false;

  async generar(input: { prompt: string; medida: Medida }): Promise<ImagenGenerada> {
    this.llamadas.push(input);
    if (this.falla) throw new Error("el proveedor de imágenes no respondió");
    return { base64: PNG_MINIMO, mimeType: "image/png", modelo: this.modelo };
  }
}

export type OpcionesDobleMedios = {
  readonly sitio?: string;
  readonly medios?: readonly MedioBreve[];
};

export class MediosEnMemoria implements MediosPort {
  readonly sitio: string;
  readonly subidas: { nombre: string; alt: string; mimeType: string; base64: string }[] = [];
  #medios: MedioBreve[];
  #siguienteId = 500;

  constructor(o: OpcionesDobleMedios = {}) {
    this.sitio = o.sitio ?? "elnegocio.com";
    this.#medios = [
      ...(o.medios ?? [
        {
          id: 12,
          titulo: "Equipo en la oficina",
          url: "https://elnegocio.com/wp-content/uploads/equipo.jpg",
          tipo: "image",
          alt: "El equipo del negocio en su oficina",
        },
      ]),
    ];
  }

  async listar(input: { buscar?: string }): Promise<readonly MedioBreve[]> {
    if (!input.buscar) return this.#medios;
    const q = input.buscar.toLowerCase();
    return this.#medios.filter((m) =>
      `${m.titulo} ${m.alt ?? ""}`.toLowerCase().includes(q),
    );
  }

  async subir(input: {
    base64: string;
    mimeType: string;
    nombre: string;
    alt: string;
  }): Promise<{ id: number; url: string }> {
    this.subidas.push(input);
    const id = this.#siguienteId++;
    const url = `https://${this.sitio}/wp-content/uploads/${input.nombre}`;
    this.#medios.push({ id, titulo: input.nombre, url, tipo: "image", alt: input.alt });
    return { id, url };
  }
}

export class AprobacionesEnMemoria implements ApprovalPort {
  readonly solicitudes: {
    id: string;
    huella: string;
    toolSlug: string;
    resumen: string;
    motivo: string;
  }[] = [];
  readonly decisiones = new Map<string, ApprovalDecision>();
  /** Cuando es true, una persona aprueba todo al instante (camino feliz). */
  apruebaTodo = false;
  #n = 0;

  decidir(huella: string, decision: ApprovalDecision): void {
    this.decisiones.set(huella, decision);
  }

  async check(input: { huella: string }): Promise<ApprovalDecision | null> {
    if (this.apruebaTodo) return "aprobada";
    return this.decisiones.get(input.huella) ?? null;
  }

  async request(input: {
    huella: string;
    toolSlug: string;
    resumen: string;
    motivo: string;
  }): Promise<ApprovalRequest> {
    const id = `ap_${++this.#n}`;
    this.solicitudes.push({
      id,
      huella: input.huella,
      toolSlug: input.toolSlug,
      resumen: input.resumen,
      motivo: input.motivo,
    });
    return { id, decision: this.decisiones.get(input.huella) ?? null };
  }
}
