/**
 * `ModelTable` del motor a partir de la tabla `model_tiers`.
 *
 * Cambiar de proveedor tiene que ser cambiar una fila, no desplegar código.
 * Las tareas del motor y las de la tabla se llaman distinto (`conversation` vs.
 * `chat`); la equivalencia se declara aquí, en un solo sitio.
 */
import { DEFAULT_MODEL_TABLE, type ModelMode, type ModelTable, type ModelTask } from '@strappy/core';
import type { TenantScope, SqlExecutor } from '../client.js';

const TAREA_A_FILA: Record<ModelTask, string> = {
  conversation: 'chat',
  summary: 'summarize',
  extraction: 'extract',
  classification: 'classify',
  builder: 'build',
  title: 'title',
};

export async function cargarTablaDeModelos(db: SqlExecutor | TenantScope): Promise<ModelTable> {
  const { rows } = await db.query<{
    mode: string;
    task: string;
    primary_model: string;
    fallback_models: string[] | null;
  }>(`select mode, task, primary_model, fallback_models from public.model_tiers`, []);

  const porFila = new Map<string, readonly string[]>();
  for (const fila of rows) {
    porFila.set(`${fila.mode}|${fila.task}`, [fila.primary_model, ...(fila.fallback_models ?? [])]);
  }
  if (porFila.size === 0) return DEFAULT_MODEL_TABLE;

  const modos: ModelMode[] = ['lite', 'max'];
  const chains = {} as Record<ModelMode, Partial<Record<ModelTask, readonly string[]>>>;
  const defaults = {} as Record<ModelMode, readonly string[]>;

  for (const modo of modos) {
    const porTarea: Partial<Record<ModelTask, readonly string[]>> = {};
    for (const [tarea, fila] of Object.entries(TAREA_A_FILA) as [ModelTask, string][]) {
      const cadena = porFila.get(`${modo}|${fila}`);
      if (cadena && cadena.length > 0) porTarea[tarea] = cadena;
    }
    chains[modo] = porTarea;
    defaults[modo] = porTarea.conversation ?? DEFAULT_MODEL_TABLE.defaults[modo];
  }

  return { chains, defaults };
}
