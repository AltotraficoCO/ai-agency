/**
 * Las plataformas de anuncios en Ajustes → Canales.
 *
 * Una sola tarjeta con las tres plataformas dentro y no tres tarjetas sueltas:
 * lo que el cliente decide aquí no es «conectar Google» sino «de dónde quiero
 * que mi agente mire mi inversión», y las tres juntas se leen de un vistazo.
 *
 * Cada plataforma conectada enseña las cuentas publicitarias que se vieron el
 * día que se conectó. Es la única forma de que alguien con tres cuentas de
 * Google sepa cuál autorizó sin tener que entrar a Google a comprobarlo.
 */
import { Heart, Megaphone, Music2, Search } from "lucide-react";
import { Badge, Button } from "@strappy/ui";
import type { Plataforma } from "@strappy/marketing";
import {
  PLATAFORMAS_ANUNCIOS,
  rutaConectar,
  type ConexionDeAnuncios,
} from "@/lib/canales/anuncios";

/**
 * Un icono por plataforma, del juego que ya usa la app.
 *
 * No son los logos de las marcas a propósito: usar la F de Facebook o la nota
 * de TikTok en su forma oficial obliga a respetar las guías de marca de cada
 * una, y una lupa, un corazón y una nota musical se entienden igual.
 */
const ICONOS: Record<Plataforma, typeof Search> = {
  google_ads: Search,
  meta_ads: Heart,
  tiktok_ads: Music2,
};

export function SeccionAnuncios({
  conexiones,
  configuradas,
  puedeConectar,
}: {
  conexiones: readonly ConexionDeAnuncios[];
  /** Las que tienen credenciales de servidor: las demás no se pueden ni intentar. */
  configuradas: readonly Plataforma[];
  puedeConectar: boolean;
}) {
  const activas = conexiones.filter((c) => c.estado === "active").length;

  return (
    <section className="strappy-slide-up overflow-hidden rounded-xl border border-border bg-raised shadow-e1">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-e1">
          <Megaphone size={24} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-fg">Anuncios</h2>
            {activas > 0 ? (
              <Badge tone="exito">
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                {activas === 1 ? "1 plataforma conectada" : `${activas} plataformas conectadas`}
              </Badge>
            ) : (
              <Badge>Sin conectar</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            Conecta dónde anuncias y tu agente de marketing te dirá cuánto te cuesta cada cliente y qué
            campaña está gastando sin traer nada.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
        {PLATAFORMAS_ANUNCIOS.map((p) => (
          <FilaPlataforma
            key={p.plataforma}
            plataforma={p}
            conexion={conexiones.find((c) => c.plataforma === p.plataforma)}
            configurada={configuradas.includes(p.plataforma)}
            puedeConectar={puedeConectar}
          />
        ))}
      </ul>

      <p className="border-t border-[var(--border-subtle)] bg-inset px-5 py-3 text-2xs text-fg-muted">
        Tu agente puede mirar desde el primer día. Para mover un presupuesto o pausar una campaña siempre te
        pedirá que lo apruebes tú.
      </p>
    </section>
  );
}

function FilaPlataforma({
  plataforma,
  conexion,
  configurada,
  puedeConectar,
}: {
  plataforma: (typeof PLATAFORMAS_ANUNCIOS)[number];
  conexion: ConexionDeAnuncios | undefined;
  configurada: boolean;
  puedeConectar: boolean;
}) {
  const Icono = ICONOS[plataforma.plataforma];
  const conectada = conexion?.estado === "active";

  return (
    <li className="flex flex-col gap-3 px-5 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-hover sm:flex-row sm:items-center">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-fg-secondary">
        <Icono size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-medium text-fg">{plataforma.nombre}</p>
          {conectada && conexion.soloLectura && <Badge tone="aviso">Solo mirar</Badge>}
          {conexion && !conectada && <Badge tone="error">Necesita revisión</Badge>}
        </div>
        <p className="text-sm text-fg-secondary">
          {conectada && conexion.cuentas.length > 0
            ? conexion.cuentas.join(" · ")
            : plataforma.descripcion}
        </p>
      </div>
      <div className="shrink-0">
        {!configurada ? (
          <p className="max-w-56 text-2xs text-fg-muted">
            Todavía no está configurada en este servidor.
          </p>
        ) : !puedeConectar ? (
          <p className="max-w-56 text-2xs text-fg-muted">
            Solo el propietario o un administrador pueden conectarla.
          </p>
        ) : (
          // Formulario GET y no enlace: un <Link> precargaría la ruta y abriría
          // el diálogo de la plataforma sin que nadie lo pidiera.
          <form action={rutaConectar(plataforma.plataforma)} method="get">
            <Button type="submit" {...(conectada ? { variant: "secondary" as const } : {})}>
              {conectada ? "Reconectar" : "Conectar"}
            </Button>
          </form>
        )}
      </div>
    </li>
  );
}
