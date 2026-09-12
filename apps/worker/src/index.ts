/**
 * Arranque del worker.
 *
 * Un proceso persistente que atiende consumidores. Hoy solo el de tareas por
 * encargo; los de WhatsApp entran como una línea más en la lista.
 *
 * El driver de Postgres se carga por especificador dinámico para que el error
 * diga qué instalar en vez de reventar al importar.
 */
import { leerConfig } from "./config.js";
import { ColaPostgres } from "./queue/postgres.js";
import { AprobacionesPostgres, BackupsPostgres, SitiosPostgres } from "./adaptadores/postgres.js";
import { CuentasPostgres } from "./adaptadores/cuentas.js";
import { LibrosPostgres } from "./adaptadores/libros.js";
import { VelocidadPostgres } from "./adaptadores/velocidad.js";
import { NominaPostgres } from "./adaptadores/nomina.js";
import { MensajeriaWhatsApp } from "./adaptadores/mensajeria.js";
import { MotorPorPlan } from "./adaptadores/motor.js";
import { ConsumidorDeTareas } from "./consumers/tareas.js";
import { ConsumidorDeVigilancia } from "./consumers/vigilancia.js";
import { VigilanciaPostgres } from "./adaptadores/vigilancia.js";
import { Runner } from "./runner.js";
import type { SitioConectado, SqlPool } from "./ports.js";
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

  // El modelo NO se fija al arrancar: cada tarea usa el de su plan (ver
  // adaptadores/motor.ts).
  const motor = new MotorPorPlan(pool);
  const referencias = referenciasDe(config.referenciasHost);
  const consumidor = new ConsumidorDeTareas({
    puertos: {
      cola: new ColaPostgres(pool, { tabla: config.tablaTareas }),
      sitios: new SitiosPostgres(pool, config.claveMaestra),
      backups: new BackupsPostgres(pool),
      aprobaciones: new AprobacionesPostgres(pool),
      // Las cuentas de publicidad del espacio. Mientras los accesos de Google
      // y Meta no estén aprobados llega sin plataformas, y el agente lo dice.
      cuentas: new CuentasPostgres(pool),
      // Los libros del negocio. Sin sistema de facturación conectado llega sin
      // contabilidad y el agente financiero lo explica en vez de fallar.
      libros: new LibrosPostgres(pool, config.claveMaestra),
      // Con qué mide el Velocista. Sin PAGESPEED_API_KEY el agente dice que no
      // pudo medir, en vez de inventarse un tiempo de carga.
      velocidad: new VelocidadPostgres(pool, config.claveMaestra, config.pagespeedApiKey),
      // Quién más trabaja para el cliente: con esto un agente puede pedirle
      // ayuda a otro, y solo a los que están contratados.
      nomina: new NominaPostgres(pool),
    },
    workerId: config.workerId,
    motorPara: (tarea) => motor.para(tarea),
    navegadorPara: (sitio) =>
      crearNavegadorPlaywright({
        baseUrl: sitio.url.startsWith("http") ? sitio.url : `https://${sitio.url}`,
        ...(config.chromePath ? { chromePath: config.chromePath } : {}),
      }),
    ...(referencias ? { referencias } : {}),
    log,
  });

  // La vigilancia no gasta créditos ni escribe en el sitio: son comprobaciones.
  // Va como un consumidor más para que comparta el apagado ordenado y no sea
  // otro proceso que alguien tenga que acordarse de arrancar.
  // El aviso se guarda siempre y se ve en Strappy; además, si el cliente
  // configuró un número, se lo mandamos por su propio WhatsApp. Que el envío
  // falle no puede tumbar la ronda: por eso solo se registra.
  const mensajeria = new MensajeriaWhatsApp(pool, config.claveMaestra);
  const vigilante = new ConsumidorDeVigilancia({
    vigilancia: new VigilanciaPostgres(pool),
    sitios: new SitiosPostgres(pool, config.claveMaestra),
    workerId: config.workerId,
    alAvisar: async ({ workspaceId, sitioUrl, aviso }) => {
      const envio = await mensajeria.avisarAlDueno({
        workspaceId,
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        ...(aviso.propuesta ? { propuesta: aviso.propuesta } : {}),
      });
      log(
        envio.enviado
          ? `[aviso] ${sitioUrl} · avisado por WhatsApp`
          : `[aviso] ${sitioUrl} · sin WhatsApp: ${envio.motivo}`,
      );
    },
    navegadorPara: (sitio: SitioConectado) =>
      crearNavegadorPlaywright({
        baseUrl: sitio.url.startsWith("http") ? sitio.url : `https://${sitio.url}`,
        ...(config.chromePath ? { chromePath: config.chromePath } : {}),
      }),
    log,
  });

  const runner = new Runner({ consumidores: [consumidor, vigilante], pollMs: config.pollMs, log });

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

  log(`worker ${config.workerId} · modelo según el plan de cada espacio · poll ${config.pollMs} ms`);
  await runner.arrancar();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
