-- ============================================================================
-- 0018 · Registro de trabajo en vivo de los encargos
-- ============================================================================
-- Mientras el Webmaster trabaja, el worker va escribiendo aquí lo que hace
-- («Leyendo el pie de página», «Instalando un plugin») con su estado. La web,
-- que refresca cada pocos segundos, lo enseña en vivo. Antes solo se guardaba
-- la conversación al terminar o al quedar esperando un clic, y la persona no
-- veía nada mientras tanto.
-- ============================================================================

alter table public.agent_tasks
  add column if not exists pasos jsonb not null default '[]'::jsonb;

comment on column public.agent_tasks.pasos is
  'Registro de trabajo: [{id, herramienta, etiqueta, estado(en_curso|hecho|error|esperando), detalle, en}], del primero al último. Lo escribe el worker en vivo.';
