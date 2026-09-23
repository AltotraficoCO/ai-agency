-- =============================================================================
-- 0049 · La imagen también se tarifa al 20%, como todo lo demás
-- =============================================================================
-- La 0046 puso las tarifas de imagen por encima del margen: 100 créditos para
-- Gemini, cuyo coste con margen son 46,8, y 250 para GPT Image 1, cuyo coste
-- con margen son 240. El colchón «para los reintentos» que escribí allí se lo
-- inventó esta migración: la regla del negocio es 20% sobre lo que cobra el
-- proveedor, la misma de la 0025 para los tokens, y no admite excepciones por
-- producto. Corregido por el cliente el 22-sep-2026.
--
-- Precios de proveedor verificados contra OpenRouter el 22-sep-2026:
--   · google/gemini-2.5-flash-image  0,039 USD → 0,039 x 1,2 / 0,001 =  46,8
--   · openai/gpt-image-1             0,200 USD → 0,200 x 1,2 / 0,001 = 240
--
-- Para Lite esto BAJA el precio de 100 a 46,8: el cliente paga menos por la
-- misma portada, que es lo correcto si el margen es el que decimos que es.
--
-- El comodín `*` deja de ser un recargo y pasa a 240, el del generador más
-- caro que conocemos. Sigue siendo el techo para un modelo sin tarifa propia,
-- pero ya no cobra por encima de lo que costaría el peor caso conocido.
--
-- El tarifario es versionado: se cierra la fila vigente y se inserta la nueva
-- en el mismo instante, sin hueco ni solape. Reaplicarla es inocuo.
-- =============================================================================

do $$
declare
  ahora timestamptz := now();
begin
  create temporary table tarifas_imagen (ref_key text, creditos numeric(16,6), descripcion text)
    on commit drop;

  insert into tarifas_imagen (ref_key, creditos, descripcion) values
    ('google/gemini-2.5-flash-image',  46.800000, 'Imagen del Disenador en Lite (0,039 USD x1,2)'),
    ('openai/gpt-image-1',            240.000000, 'Imagen del Disenador en Max (0,200 USD x1,2)'),
    ('*',                             240.000000, 'Generador sin tarifa propia: el techo del mas caro conocido');

  update public.credit_rates r
     set effective_to = ahora
    from tarifas_imagen n
   where r.kind = 'model_image'
     and r.ref_key = n.ref_key
     and r.effective_to is null
     and r.credits_per_unit is distinct from n.creditos;

  insert into public.credit_rates (kind, ref_key, unit, credits_per_unit, description, effective_from)
  select 'model_image', n.ref_key, 'unit', n.creditos, n.descripcion, ahora
    from tarifas_imagen n
   where not exists (
     select 1
       from public.credit_rates r
      where r.kind = 'model_image'
        and r.ref_key = n.ref_key
        and r.effective_to is null
   );
end $$;
