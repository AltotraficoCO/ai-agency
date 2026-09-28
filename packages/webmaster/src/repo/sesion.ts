/**
 * La sesión de trabajo de un encargo sobre el repositorio del cliente.
 *
 * Es una copia del repo en memoria —el tarball de la rama, descomprimido— con
 * los cambios del agente encima. Nada se sube hasta que el agente guarda: así
 * un cambio que toca cinco archivos llega como UN commit y dispara UNA vista
 * previa, no cinco builds a medias.
 *
 * Lo que no puede vivir solo en memoria —la rama elegida y los cambios sin
 * subir— se guarda en `RepoEstadoPort` tras cada cambio. El encargo se pausa
 * cuando pregunta algo al cliente, y al reanudarse lo retoma otro proceso: sin
 * eso, la respuesta del cliente llegaría a una sesión que ya no existe.
 *
 * La rama sale SIEMPRE de lo que el cliente pulsó, leído de su respuesta
 * guardada, nunca de lo que el modelo diga que eligió. Trabajar directo en la
 * rama principal es publicar en vivo, y eso no puede depender de que el modelo
 * repita bien una respuesta.
 */
import type {
  ApprovalPort,
  ArchivoPendiente,
  EstadoRepo,
  RepoCreds,
  RepoEstadoPort,
  TipoRama,
} from "../ports.js";
import * as gh from "./github.js";
import { leerTarball } from "./tar.js";
import { contarCambios, diffUnificado } from "./diff.js";
import { ignorada, motivoProhibido, motivoRamaInvalida } from "./reglas.js";

export type ArchivoRepo = {
  /** `null` si es binario o demasiado grande para cargarlo. */
  readonly texto: string | null;
  readonly binario: boolean;
  readonly tamano: number;
  readonly modo: string;
};

/** Texto más grande que esto no se carga: no es código que se edite a mano. */
const TOPE_ARCHIVO = 1_000_000;
/** Tope de texto cargado por repositorio. */
const TOPE_TOTAL = 80_000_000;

export const ESTADO_VACIO: EstadoRepo = {
  rama: null,
  tipoRama: null,
  cambios: {},
  pr: null,
  ultimoCommit: null,
  preguntaRama: null,
};

const decodificador = new TextDecoder("utf-8", { fatal: true });

function aTexto(bytes: Uint8Array): string | null {
  const muestra = bytes.subarray(0, 8000);
  if (muestra.includes(0)) return null;
  try {
    return decodificador.decode(bytes);
  } catch {
    return null;
  }
}

export type ContextoSesion = {
  readonly workspaceId: string;
  readonly taskId: string;
  readonly siteId: string;
  readonly approvals: ApprovalPort;
  readonly puerto?: RepoEstadoPort;
  readonly opciones: gh.GithubOptions;
};

export type CambioPendiente = {
  readonly ruta: string;
  readonly accion: "crear" | "modificar" | "borrar" | "binario";
  readonly mas: number;
  readonly menos: number;
};

export class RepoSesion {
  #base = new Map<string, ArchivoRepo>();
  #refCargada = "";
  #shaCargado = "";
  #estado: EstadoRepo = ESTADO_VACIO;
  #omitidos = 0;
  /** Lo que el cliente escribió cuando no nombraba ninguna rama ofrecida, hasta que el agente lo lea. */
  #respuestaLibre: string | null = null;

  private constructor(
    readonly creds: RepoCreds,
    private readonly ctx: ContextoSesion,
  ) {}

  /** Abre la sesión: retoma lo guardado del encargo y descarga la rama que toca. */
  static async abrir(creds: RepoCreds, ctx: ContextoSesion): Promise<RepoSesion> {
    const s = new RepoSesion(creds, ctx);
    s.#estado = (await ctx.puerto?.cargar({ workspaceId: ctx.workspaceId, taskId: ctx.taskId })) ?? ESTADO_VACIO;
    // Si la rama del encargo ya existe allí, se trabaja sobre ella; si aún no
    // (una rama nueva se crea al primer commit), sobre la principal.
    const rama = s.#estado.rama;
    const existe = rama ? await gh.shaDeRama(creds, rama, ctx.opciones) : null;
    await s.#cargar(existe && rama ? rama : creds.ramaPrincipal);
    await s.resolverPreguntaPendiente();
    return s;
  }

  async #cargar(rama: string): Promise<void> {
    const sha = await gh.shaDeRama(this.creds, rama, this.ctx.opciones);
    if (!sha) throw new Error(`La rama «${rama}» no existe en ${this.creds.owner}/${this.creds.repo}.`);
    const tar = leerTarball(await gh.descargarTarball(this.creds, sha, this.ctx.opciones));
    const base = new Map<string, ArchivoRepo>();
    let total = 0;
    let omitidos = 0;
    for (const a of tar.archivos) {
      if (ignorada(a.ruta)) continue;
      const cabe = a.bytes.length <= TOPE_ARCHIVO;
      const decodificado = cabe ? aTexto(a.bytes) : null;
      const binario = cabe && decodificado === null;
      const texto = decodificado !== null && total < TOPE_TOTAL ? decodificado : null;
      if (texto !== null) total += texto.length;
      else if (!binario) omitidos++;
      base.set(a.ruta, { texto, binario, tamano: a.bytes.length, modo: a.modo });
    }
    this.#base = base;
    this.#refCargada = rama;
    this.#shaCargado = tar.commit ?? sha;
    this.#omitidos = omitidos;
  }

  async #guardar(): Promise<void> {
    await this.ctx.puerto?.guardar({
      workspaceId: this.ctx.workspaceId,
      taskId: this.ctx.taskId,
      siteId: this.ctx.siteId,
      estado: this.#estado,
    });
  }

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  get estado(): EstadoRepo {
    return this.#estado;
  }

  get ramaCargada(): string {
    return this.#refCargada;
  }

  get commitCargado(): string {
    return this.#shaCargado;
  }

  get archivosOmitidos(): number {
    return this.#omitidos;
  }

  /** La rama donde se escribe, o un error que dice cómo elegirla. */
  ramaDeTrabajo(): string {
    const r = this.#estado.rama;
    if (!r) {
      throw new Error(
        "Todavía no hay rama de trabajo. Explora el repositorio y llama a repo_elegir_rama con tu recomendación: el cliente elige con un botón dónde van los cambios.",
      );
    }
    return r;
  }

  async anotar(parcial: Partial<EstadoRepo>): Promise<void> {
    this.#estado = { ...this.#estado, ...parcial };
    await this.#guardar();
  }

  // -------------------------------------------------------------------------
  // La rama
  // -------------------------------------------------------------------------

  /** Registra la pregunta de la rama: la respuesta se aplicará sola al volver. */
  async registrarPregunta(pregunta: NonNullable<EstadoRepo["preguntaRama"]>): Promise<void> {
    await this.anotar({ preguntaRama: pregunta });
  }

  /**
   * Si el cliente ya contestó la pregunta de la rama, la aplica. Se llama al
   * abrir la sesión: el encargo retoma con la rama puesta aunque el modelo no
   * vuelva a preguntar.
   */
  async resolverPreguntaPendiente(): Promise<{ aplicada: boolean; respuesta: string | null }> {
    const p = this.#estado.preguntaRama;
    if (!p || !this.ctx.approvals.respuesta) return { aplicada: false, respuesta: null };
    const respuesta = await this.ctx.approvals.respuesta({
      workspaceId: this.ctx.workspaceId,
      taskId: this.ctx.taskId,
      huella: p.huella,
    });
    if (respuesta === null) return { aplicada: false, respuesta: null };

    const texto = respuesta.trim();
    const exacto = p.destinos.find((d) => d.etiqueta === texto);
    // Si escribió en vez de pulsar: vale nombrar una de las ramas ofrecidas que
    // NO sea la principal. La principal solo se elige con su botón: «publica en
    // vivo» no se deduce de un texto libre.
    const nombrada = exacto
      ? null
      : p.destinos.find((d) => d.tipo !== "principal" && texto.toLowerCase().includes(d.rama.toLowerCase()));
    const destino = exacto ?? nombrada;
    if (!destino) {
      this.#respuestaLibre = texto;
      await this.anotar({ preguntaRama: null });
      return { aplicada: false, respuesta: texto };
    }
    await this.usarRama(destino.tipo, destino.rama);
    return { aplicada: true, respuesta: texto };
  }

  /** La respuesta libre del cliente que aún no leyó el agente; se entrega una vez. */
  tomarRespuestaLibre(): string | null {
    const r = this.#respuestaLibre;
    this.#respuestaLibre = null;
    return r;
  }

  /**
   * Fija la rama de trabajo. La principal solo llega aquí desde la respuesta
   * del cliente; las herramientas no la ofrecen de otra forma.
   */
  async usarRama(tipo: TipoRama, rama: string): Promise<void> {
    const nombre = tipo === "principal" ? this.creds.ramaPrincipal : rama.trim();
    const invalida = motivoRamaInvalida(nombre);
    if (invalida) throw new Error(`Rama «${nombre}»: ${invalida}.`);
    if (nombre !== this.#estado.rama && Object.keys(this.#estado.cambios).length > 0) {
      throw new Error(
        `Hay cambios sin subir en «${this.#estado.rama}». Súbelos con repo_guardar_cambios antes de cambiar de rama.`,
      );
    }

    const sha = await gh.shaDeRama(this.creds, nombre, this.ctx.opciones);
    if (tipo === "nueva") {
      if (sha && nombre !== this.#estado.rama) {
        throw new Error(`Ya existe una rama «${nombre}». Propón otro nombre o ofrécela como rama existente.`);
      }
      // Una rama nueva nace de la principal. Si ya se creó en este encargo, de sí misma.
      const origen = sha ? nombre : this.creds.ramaPrincipal;
      if (this.#refCargada !== origen) await this.#cargar(origen);
    } else {
      if (!sha) throw new Error(`La rama «${nombre}» no existe en el repositorio.`);
      if (this.#refCargada !== nombre) await this.#cargar(nombre);
    }
    await this.anotar({ rama: nombre, tipoRama: tipo, preguntaRama: null });
  }

  // -------------------------------------------------------------------------
  // Lectura: la rama cargada con los cambios del agente encima
  // -------------------------------------------------------------------------

  rutas(): string[] {
    const todas = new Set(this.#base.keys());
    for (const [r, c] of Object.entries(this.#estado.cambios)) {
      if (c === null) todas.delete(r);
      else todas.add(r);
    }
    return [...todas].sort();
  }

  existe(ruta: string): boolean {
    const c = this.#estado.cambios[ruta];
    if (c !== undefined) return c !== null;
    return this.#base.has(ruta);
  }

  /** Texto original en la rama cargada, sin los cambios del agente. */
  original(ruta: string): string | undefined {
    return this.#base.get(ruta)?.texto ?? undefined;
  }

  info(ruta: string): ArchivoRepo | undefined {
    return this.#base.get(ruta);
  }

  leer(ruta: string): string {
    const c = this.#estado.cambios[ruta];
    if (c === null) throw new Error(`«${ruta}» está marcado para borrarse en este encargo.`);
    if (c && "texto" in c) return c.texto;
    if (c && "base64" in c) throw new Error(`«${ruta}» es un archivo binario (imagen, fuente…): no se lee como texto.`);
    const a = this.#base.get(ruta);
    if (!a) throw new Error(`No existe «${ruta}». Búscalo con repo_buscar o repo_arbol: no adivines rutas.`);
    if (a.binario) throw new Error(`«${ruta}» es un archivo binario (${a.tamano} bytes): no se lee como texto.`);
    if (a.texto === null) throw new Error(`«${ruta}» pesa ${a.tamano} bytes: demasiado para editarlo a mano.`);
    return a.texto;
  }

  /** Busca un patrón en todos los archivos de texto. */
  buscar(
    patron: RegExp,
    filtro: (ruta: string) => boolean,
    max: number,
  ): { ruta: string; linea: number; texto: string }[] {
    const out: { ruta: string; linea: number; texto: string }[] = [];
    for (const ruta of this.rutas()) {
      if (!filtro(ruta)) continue;
      let texto: string;
      try {
        texto = this.leer(ruta);
      } catch {
        continue;
      }
      const lineas = texto.split("\n");
      for (let i = 0; i < lineas.length; i++) {
        patron.lastIndex = 0;
        if (patron.test(lineas[i]!)) {
          out.push({ ruta, linea: i + 1, texto: lineas[i]!.trim().slice(0, 240) });
          if (out.length >= max) return out;
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Escritura: solo en memoria y en el estado guardado, hasta repo_guardar_cambios
  // -------------------------------------------------------------------------

  #comprobarEscritura(ruta: string): void {
    this.ramaDeTrabajo();
    const prohibido = motivoProhibido(ruta);
    if (prohibido) throw new Error(`No puedo escribir «${ruta}»: ${prohibido}.`);
  }

  async #poner(ruta: string, valor: ArchivoPendiente): Promise<void> {
    const cambios = { ...this.#estado.cambios };
    const base = this.#base.get(ruta);
    // Volver a dejarlo como estaba no es un cambio.
    const igual =
      (valor === null && !base) ||
      (valor !== null && "texto" in valor && base?.texto === valor.texto);
    if (igual) delete cambios[ruta];
    else cambios[ruta] = valor;
    await this.anotar({ cambios });
  }

  async escribir(ruta: string, texto: string): Promise<void> {
    this.#comprobarEscritura(ruta);
    await this.#poner(ruta, { texto });
  }

  async escribirBinario(ruta: string, base64: string): Promise<void> {
    this.#comprobarEscritura(ruta);
    await this.#poner(ruta, { base64 });
  }

  async borrar(ruta: string): Promise<void> {
    this.#comprobarEscritura(ruta);
    if (!this.existe(ruta)) throw new Error(`No existe «${ruta}».`);
    await this.#poner(ruta, null);
  }

  /** Deja un archivo como estaba en otro commit (o lo borra si allí no existía). */
  async restaurar(ruta: string, contenido: { base64: string } | null): Promise<void> {
    this.#comprobarEscritura(ruta);
    if (contenido === null) {
      if (this.existe(ruta)) await this.#poner(ruta, null);
      return;
    }
    const bytes = Buffer.from(contenido.base64, "base64");
    const texto = aTexto(bytes);
    await this.#poner(ruta, texto !== null ? { texto } : { base64: contenido.base64 });
  }

  /** Descarta los cambios sin subir de una ruta, o de todas. */
  async descartar(ruta?: string): Promise<string[]> {
    const cambios = { ...this.#estado.cambios };
    const quitadas = ruta ? (ruta in cambios ? [ruta] : []) : Object.keys(cambios);
    for (const r of quitadas) delete cambios[r];
    await this.anotar({ cambios });
    return quitadas;
  }

  pendientes(): CambioPendiente[] {
    return Object.entries(this.#estado.cambios).map(([ruta, c]) => {
      const antes = this.#base.get(ruta)?.texto ?? null;
      if (c === null) return { ruta, accion: "borrar" as const, mas: 0, menos: antes?.split("\n").length ?? 0 };
      if ("base64" in c) return { ruta, accion: "binario" as const, mas: 0, menos: 0 };
      const { mas, menos } = contarCambios(antes, c.texto);
      return { ruta, accion: this.#base.has(ruta) ? ("modificar" as const) : ("crear" as const), mas, menos };
    });
  }

  diff(ruta?: string): string {
    const rutas = ruta ? [ruta] : Object.keys(this.#estado.cambios);
    return rutas
      .map((r) => {
        const c = this.#estado.cambios[r];
        if (c === undefined) return "";
        if (c !== null && "base64" in c) return `--- ${r}\n(binario: ${Math.round((c.base64.length * 3) / 4)} bytes)`;
        return diffUnificado(r, this.#base.get(r)?.texto ?? null, c === null ? null : c.texto);
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Subir
  // -------------------------------------------------------------------------

  /**
   * Un commit con todo lo pendiente en la rama de trabajo. Crea la rama si es
   * nueva. Si alguien empujó a la rama mientras tanto, sigue encima de su
   * trabajo salvo que haya tocado los mismos archivos: entonces para, porque
   * pisarle el cambio a una persona no es algo que el agente pueda decidir.
   */
  async subir(mensaje: string): Promise<{ sha: string; rama: string; archivos: number; creada: boolean }> {
    const rama = this.ramaDeTrabajo();
    const cambios = this.#estado.cambios;
    const rutas = Object.keys(cambios);
    if (rutas.length === 0) throw new Error("No hay cambios pendientes que subir.");

    let remoto = await gh.shaDeRama(this.creds, rama, this.ctx.opciones);
    let creada = false;
    if (!remoto) {
      if (this.#estado.tipoRama !== "nueva") throw new Error(`La rama «${rama}» ya no existe en el repositorio.`);
      await gh.crearRama(this.creds, rama, this.#shaCargado, this.ctx.opciones);
      remoto = this.#shaCargado;
      creada = true;
    }

    let recargar = false;
    if (remoto !== this.#shaCargado) {
      const { archivos } = await gh.comparar(this.creds, this.#shaCargado, remoto, this.ctx.opciones);
      const pisados = archivos.map((a) => a.ruta).filter((r) => r in cambios);
      if (pisados.length) {
        throw new Error(
          `Alguien cambió ${pisados.join(", ")} en «${rama}» mientras trabajabas. No subo para no pisar su trabajo: ` +
            "descarta tus cambios en esos archivos con repo_descartar, vuelve a leerlos y rehaz el cambio encima.",
        );
      }
      recargar = true;
    }

    const sha = await gh.commitArchivos(
      this.creds,
      {
        rama,
        padre: remoto,
        mensaje,
        archivos: rutas.map((ruta) => ({
          ruta,
          contenido: cambios[ruta] ?? null,
          modo: this.#base.get(ruta)?.modo ?? "100644",
        })),
      },
      this.ctx.opciones,
    );

    if (recargar) {
      await this.anotar({ cambios: {}, ultimoCommit: sha });
      await this.#cargar(rama);
    } else {
      for (const [ruta, c] of Object.entries(cambios)) {
        if (c === null) this.#base.delete(ruta);
        else {
          const modo = this.#base.get(ruta)?.modo ?? "100644";
          this.#base.set(
            ruta,
            "texto" in c
              ? { texto: c.texto, binario: false, tamano: c.texto.length, modo }
              : { texto: null, binario: true, tamano: Math.round((c.base64.length * 3) / 4), modo },
          );
        }
      }
      this.#refCargada = rama;
      this.#shaCargado = sha;
      await this.anotar({ cambios: {}, ultimoCommit: sha });
    }
    return { sha, rama, archivos: rutas.length, creada };
  }
}
