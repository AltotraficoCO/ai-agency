/**
 * La rama: la elige el cliente con un botón, a propuesta del agente.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import type { TipoRama } from "../../ports.js";
import { huellaAccion } from "../../aprobacion.js";
import * as gh from "../../repo/github.js";
import { motivoRamaInvalida, slugRama } from "../../repo/reglas.js";
import { trabajo } from "./sesion.js";

function recortarEtiqueta(texto: string): string {
  return texto.length <= 80 ? texto : `${texto.slice(0, 77)}…`;
}

export const repoElegirRama = defineTool({
  slug: "repo_elegir_rama",
  label: "Proponer la rama de trabajo",
  description:
    "Le pregunta al cliente, con botones, dónde van los cambios de este encargo: una rama NUEVA (que tú nombras), la rama PRINCIPAL (se publica en vivo) o una rama EXISTENTE. Tú haces la recomendación y va primera. La tarea se pausa hasta que el cliente pulse, y al volver la rama elegida ya está puesta.",
  whenToUse:
    "después de explorar y ANTES de editar nada, una sola vez por encargo. Si ya hay rama de trabajo (repo_info la dice), no vuelvas a preguntar",
  inputSchema: z.object({
    recomendacion: z
      .enum(["nueva", "principal", "existente"])
      .describe("Lo que recomiendas. Casi siempre «nueva»: permite revisar la vista previa antes de publicar."),
    rama_nueva: z
      .string()
      .min(3)
      .max(80)
      .describe("Nombre para la rama nueva, en minúsculas y con guiones, que diga qué cambia: strappy/nuevo-banner-portada."),
    rama_existente: z
      .string()
      .max(100)
      .optional()
      .describe("Si recomiendas una existente (p. ej. develop o staging), cuál."),
    otras_existentes: z.array(z.string().max(100)).max(2).optional().describe("Otras ramas existentes que tenga sentido ofrecer."),
    motivo: z.string().min(10).max(240).describe("Por qué recomiendas esa opción, en una frase para el cliente."),
  }),
  sensitive: false,
  creditCost: 0,
  scopes: [SCOPES.repoRead],
  effect: "write_internal",
  kind: "system",
  async execute(ctx, input): Promise<Record<string, unknown>> {
    const { sitio, creds, opciones, sesion } = await trabajo(ctx, "repo_elegir_rama");

    // Retomado: si el cliente ya contestó, la sesión lo aplicó al abrirse.
    if (sesion.estado.rama) {
      return {
        rama: sesion.estado.rama,
        tipo: sesion.estado.tipoRama,
        nota:
          sesion.estado.tipoRama === "principal"
            ? `El cliente eligió trabajar directo en «${sesion.estado.rama}»: lo que subas se publica en vivo. Sé especialmente cuidadoso y verifica el build.`
            : `Trabajas en «${sesion.estado.rama}». Sigue con el encargo.`,
      };
    }
    const resuelta = await sesion.resolverPreguntaPendiente();
    if (resuelta.aplicada) {
      return { rama: sesion.estado.rama, tipo: sesion.estado.tipoRama, respuesta_del_cliente: resuelta.respuesta };
    }
    // La pudo resolver ya la sesión al abrirse: se entrega aquí una sola vez.
    const libre = resuelta.respuesta ?? sesion.tomarRespuestaLibre();
    if (libre !== null) {
      return {
        respuesta_libre_del_cliente: libre,
        nota:
          "El cliente escribió en vez de pulsar, y no nombra una de las ramas ofrecidas. Interpreta lo que pide y vuelve a llamar a repo_elegir_rama con una propuesta que lo recoja.",
      };
    }

    // La rama nueva lleva siempre el prefijo: así se reconocen los cambios de Strappy.
    const nueva = input.rama_nueva.startsWith("strappy/") ? input.rama_nueva : `strappy/${slugRama(input.rama_nueva) || "cambio"}`;
    const invalida = motivoRamaInvalida(nueva);
    if (invalida) throw new Error(`«${nueva}»: ${invalida}.`);

    const ramas = await gh.listarRamas(creds, opciones);
    const existentes = new Set(ramas.map((r) => r.nombre));
    if (existentes.has(nueva)) {
      throw new Error(`Ya existe una rama «${nueva}». Propón otro nombre, u ofrécela como existente.`);
    }
    const pedidas = [
      ...(input.recomendacion === "existente" && input.rama_existente ? [input.rama_existente] : []),
      ...(input.otras_existentes ?? []),
    ].filter((r, i, a) => r !== creds.ramaPrincipal && a.indexOf(r) === i);
    const inexistentes = pedidas.filter((r) => !existentes.has(r));
    if (inexistentes.length) {
      throw new Error(`No existen: ${inexistentes.join(", ")}. Mira las ramas reales con repo_ramas.`);
    }
    if (input.recomendacion === "existente" && !input.rama_existente) {
      throw new Error("Recomiendas una rama existente: di cuál en rama_existente.");
    }

    type Destino = { etiqueta: string; tipo: TipoRama; rama: string };
    const destinos: Destino[] = [
      { tipo: "nueva", rama: nueva, etiqueta: `Rama nueva «${nueva}»` },
      { tipo: "principal", rama: creds.ramaPrincipal, etiqueta: `Directo a «${creds.ramaPrincipal}» (se publica en vivo)` },
      ...pedidas.map((r) => ({ tipo: "existente" as const, rama: r, etiqueta: `Rama existente «${r}»` })),
    ];
    const recomendado =
      input.recomendacion === "existente"
        ? destinos.find((d) => d.tipo === "existente" && d.rama === input.rama_existente)
        : destinos.find((d) => d.tipo === input.recomendacion);
    const ordenados = recomendado ? [recomendado, ...destinos.filter((d) => d !== recomendado)] : destinos;
    const finales = ordenados.map((d, i) => ({
      ...d,
      etiqueta: recortarEtiqueta(i === 0 && recomendado ? `${d.etiqueta} · recomendado` : d.etiqueta),
    }));

    const pregunta = `¿Dónde guardo los cambios en ${creds.owner}/${creds.repo}? Te recomiendo: ${input.motivo}`.slice(0, 300);
    const entrada = {
      pregunta,
      opciones: finales.map((d) => d.etiqueta),
      // Solo botones: «publica en vivo» no se deduce de un texto libre.
      permite_texto: false,
      destinos: finales,
    };

    if (ctx.dryRun) {
      return {
        simulado: true,
        pregunta,
        opciones: entrada.opciones,
        nota: "Simulación: no se preguntó. Inclúyelo en el plan: el cliente elegirá la rama con un botón.",
      };
    }

    const huella = huellaAccion(sitio.taskId, "repo_elegir_rama", { destinos: finales.map((d) => `${d.tipo}:${d.rama}`) });
    // La misma pregunta ya contestada no se vuelve a hacer: quedaría esperando
    // un clic que ya se dio, y el encargo no se reanudaría nunca.
    if (await sitio.approvals.check({ workspaceId: ctx.workspaceId, taskId: sitio.taskId, huella })) {
      await sesion.registrarPregunta({ huella, destinos: finales });
      const otra = await sesion.resolverPreguntaPendiente();
      if (otra.aplicada) return { rama: sesion.estado.rama, tipo: sesion.estado.tipoRama, respuesta_del_cliente: otra.respuesta };
      sesion.tomarRespuestaLibre();
      return {
        respuesta_libre_del_cliente: otra.respuesta,
        nota: "El cliente ya contestó a esta misma pregunta sin elegir una opción. Cambia la propuesta (otro nombre de rama u otra recomendación) según lo que dijo.",
      };
    }
    const solicitud = await sitio.approvals.request({
      workspaceId: ctx.workspaceId,
      taskId: sitio.taskId,
      siteId: sitio.siteId,
      huella,
      // Se registra como pregunta: la web la pinta con botones y el bucle se detiene.
      toolSlug: "preguntar_al_cliente",
      motivo: "elegir dónde van los cambios",
      resumen: pregunta,
      entrada,
    });
    await sesion.registrarPregunta({ huella, destinos: finales });
    return {
      requiere_aprobacion: true,
      es_pregunta: true,
      solicitud_id: solicitud.id,
      motivo: "pregunta al cliente",
      opciones: entrada.opciones,
      mensaje:
        "Pregunta enviada con botones. Detente aquí y no hagas nada más: cuando el cliente pulse, la rama quedará puesta y retomarás el encargo.",
    };
  },
});
