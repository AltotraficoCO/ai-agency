/**
 * Arranque del worker.
 *
 * Un proceso persistente que atiende consumidores. Hoy solo el de tareas por
 * encargo; los de WhatsApp entran como una línea más en la lista.
 *
 * El driver de Postgres se carga por especificador dinámico: el paquete no lo
 * declara como dependencia para que quien despliegue elija `pg` o el pool que
 * ya tenga, y el error dice qué instalar en vez de reventar al importar.
 */
import { leerConfig, TARIFAS_POR_DEFECTO } from "./config.js";
import { ColaPostgres } from "./queue/postgres.js";
import { AprobacionesPostgres, BackupsPostgres, SitiosPostgres } from "./adaptadores/postgres.js";
import { ConsumidorDeTareas } from "./consumers/tareas.js";
import { Runner } from "./runner.js";
import type { SqlPool } from "./ports.js";
import { crearNavegadorPlaywright, type ReferencePort } from "@strappy/webmaster";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cualquiera = any;

async function abrirPool(url: string): Promise<SqlPool> {
  const especificador = "pg";
  let pg: Cualquiera;
  try {
    pg = await import(especificador);
  } catch {
    throw new Error("Falta el driver de Postgres: instala `pg` en apps/worker.");
  }
  const pool = new (pg.default?.Pool ?? pg.Pool)({ connectionString: url, max: 4 });
  return pool as SqlPool;
}

function referenciasDe(host: string | undefined): ReferencePort | undefined {
  if (!host) return undefined;
  return {
    hostsPermitidos: [host],
    async descargar(url: string) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`No pude descargar la referencia (${res.status}).`);
      return {
        mimeType: res.headers.get("content-type") ?? "application/octet-stream",
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}

async function main(): Promise<void> {
  const config = leerConfig();
  const pool = await abrirPool(config.databaseUrl);
  const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

  const referencias = referenciasDe(config.referenciasHost);
  const consumidor = new ConsumidorDeTareas({
    puertos: {
      cola: new ColaPostgres(pool, { tabla: config.tablaTareas }),
      sitios: new SitiosPostgres(pool, config.claveMaestra),
      backups: new BackupsPostgres(pool),
      aprobaciones: new AprobacionesPostgres(pool),
    },
    workerId: config.workerId,
    // Una cadena "proveedor/modelo" la resuelve el AI SDK contra la pasarela;
    // si mañana se quiere un proveedor directo, se sustituye aquí y ya.
    model: config.modelId,
    modelId: config.modelId,
    rates: TARIFAS_POR_DEFECTO,
    navegadorPara: (sitio) =>
      crearNavegadorPlaywright({
        baseUrl: sitio.url.startsWith("http") ? sitio.url : `https://${sitio.url}`,
        ...(config.chromePath ? { chromePath: config.chromePath } : {}),
      }),
    ...(referencias ? { referencias } : {}),
    log,
  });

  const runner = new Runner({ consumidores: [consumidor], pollMs: config.pollMs, log });

  let parando = false;
  for (const señal of ["SIGTERM", "SIGINT"] as const) {
    process.on(señal, () => {
      if (parando) return;
      parando = true;
      log(`${señal}: terminando el trabajo en curso antes de salir…`);
      void runner
        .parar()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
  }

  log(`worker ${config.workerId} · modelo ${config.modelId} · poll ${config.pollMs} ms`);
  await runner.arrancar();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
