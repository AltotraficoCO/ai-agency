/**
 * Prueba el Webmaster contra un WordPress DE VERDAD, sin base de datos.
 *
 * Existe porque los tests de este repositorio corren contra un doble de la
 * REST API, y un doble no prueba que el WordPress del cliente tenga la REST
 * API abierta, las contraseñas de aplicación activas, el plugin conector
 * puesto o un proxy delante que se coma la cabecera Authorization. Eso solo lo
 * dice un sitio real.
 *
 *   export WP_URL=https://misitio.com
 *   export WP_USER=admin
 *   export WP_APP_PASSWORD='abcd EFGH ijkl MNOP qrst UVWX'
 *
 *   pnpm probar-sitio salud
 *   pnpm probar-sitio plan     "cambia el título de la página de contacto a «Hablemos»"
 *   pnpm probar-sitio ejecutar "cambia el título de la página de contacto a «Hablemos»"
 *
 * `salud` no gasta ni un token: solo lee. `plan` corre el agente en modo
 * simulación (no muta nada) y necesita una clave de modelo en el entorno.
 * `ejecutar` sí toca el sitio; empieza siempre por `plan`.
 */
import {
  ejecutarTareaWebmaster,
  webmaster,
  wordpress,
  type ApprovalDecision,
  type BackupRecord,
  type SitioContext,
} from "@strappy/webmaster";
import { TARIFAS_POR_DEFECTO } from "../src/config.js";

const [, , comando = "salud", ...resto] = process.argv;
const encargo = resto.join(" ");

const creds = {
  url: process.env.WP_URL ?? "",
  user: process.env.WP_USER ?? "",
  appPassword: process.env.WP_APP_PASSWORD ?? "",
};

if (!creds.url || !creds.user || !creds.appPassword) {
  console.error("Faltan WP_URL, WP_USER o WP_APP_PASSWORD en el entorno.");
  process.exit(1);
}

/** Backups en un fichero de la sesión: sin base de datos, pero reversibles. */
const backupsEnMemoria: BackupRecord[] = [];
let n = 0;

/** En esta prueba las aprobaciones se piden por consola. */
const decisiones = new Map<string, ApprovalDecision>();

const sitio: SitioContext = {
  siteId: "prueba",
  taskId: `prueba-${Date.now()}`,
  tipo: "wp",
  wp: creds,
  backups: {
    async create(input) {
      const id = `bk_${++n}`;
      backupsEnMemoria.push({
        id,
        alcance: input.alcance,
        snapshot: input.snapshot,
        creadoEn: new Date().toISOString(),
      });
      console.log(`  · backup ${id} (${input.alcance})`);
      return id;
    },
    async read(input) {
      return backupsEnMemoria.find((b) => b.id === input.backupId) ?? null;
    },
  },
  approvals: {
    async check(input) {
      return decisiones.get(input.huella) ?? null;
    },
    async request(input) {
      console.log(`\n  ⚠︎ APROBACIÓN NECESARIA · ${input.toolSlug}: ${input.motivo}`);
      console.log(`    ${JSON.stringify(input.entrada).slice(0, 300)}`);
      console.log("    (esta prueba no ejecuta acciones sensibles; apruébalas desde el panel)\n");
      return { id: `ap_${input.huella.slice(0, 8)}`, decision: null };
    },
  },
  primerContacto: comando === "plan",
};

async function salud(): Promise<void> {
  console.log(`Diagnóstico de ${creds.url}\n`);
  const h = await wordpress.health(creds);
  console.log("  REST API accesible:", h.ok ? "sí" : `NO — ${h.error}`);
  console.log("  Credenciales válidas:", h.writable ? "sí" : `NO — ${h.error}`);
  console.log("  Nombre del sitio:", h.siteName ?? "(no lo dice)");
  if (!h.ok || !h.writable) {
    console.log(
      "\n  El agente no podrá trabajar así. Revisa que /wp-json responda y que la contraseña de aplicación esté activa.",
    );
    process.exit(2);
  }

  const contenido = await wordpress.listarContenido(creds);
  console.log(`\n  ${contenido.length} contenidos:`);
  for (const c of contenido.slice(0, 15)) {
    console.log(`    [${c.tipo} ${c.id}] ${c.titulo} — /${c.slug}`);
  }

  const plugins = await wordpress.listarPlugins(creds);
  console.log(`\n  ${plugins.length} plugins:`);
  for (const p of plugins) console.log(`    ${p.status === "active" ? "●" : "○"} ${p.name}`);
  const elementor = plugins.some((p) => p.plugin.startsWith("elementor/") && p.status === "active");
  console.log(`\n  Elementor activo: ${elementor ? "sí" : "no"}`);

  const ajustes = await wordpress.leerAjustes(creds);
  console.log(`  Portada: ${ajustes.show_on_front} (page_on_front = ${ajustes.page_on_front})`);
  console.log("\nTodo lo que el agente necesita para leer está en su sitio.");
}

async function correrAgente(simulacion: boolean): Promise<void> {
  if (!encargo) {
    console.error('Pasa el encargo: … plan "cambia el título de la página X"');
    process.exit(1);
  }
  const modelId = process.env.WORKER_MODEL ?? "anthropic/claude-sonnet-4-5";
  console.log(`${simulacion ? "Simulación" : "EJECUCIÓN REAL"} · ${modelId} · ${creds.url}\n`);

  const resultado = await ejecutarTareaWebmaster({
    agent: webmaster,
    model: modelId,
    modelId,
    rates: TARIFAS_POR_DEFECTO,
    workspaceId: "prueba",
    agentName: process.env.WP_AGENT_NAME ?? "Max",
    sitio: { ...sitio, primerContacto: simulacion },
    tarea: { id: sitio.taskId, titulo: encargo, detalle: null },
    onEvento: (m) => console.log(`  ${m}`),
  });

  console.log(`\n── estado: ${resultado.estado} ──`);
  console.log(`acciones: ${resultado.evidencia.acciones.length}`);
  console.log(`pasos del modelo: ${resultado.evidencia.pasos}`);
  console.log(`créditos: ${resultado.evidencia.creditos}`);
  console.log(`backups: ${resultado.evidencia.backups.join(", ") || "(ninguno)"}`);
  console.log(`capturas: ${resultado.evidencia.capturas.length}`);
  if (resultado.estado === "fallida") {
    console.log(`error (${resultado.motivo}): ${resultado.error}`);
    process.exit(3);
  }
  console.log(`\nRESUMEN: ${resultado.resumen}`);
}

const comandos: Record<string, () => Promise<void>> = {
  salud,
  plan: () => correrAgente(true),
  ejecutar: () => correrAgente(false),
};

const elegido = comandos[comando];
if (!elegido) {
  console.error(`Comando desconocido "${comando}". Usa: salud | plan | ejecutar`);
  process.exit(1);
}
await elegido().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
