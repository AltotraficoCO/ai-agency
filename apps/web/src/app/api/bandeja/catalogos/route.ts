/** Etiquetas, compañeros, respuestas rápidas, canales y agentes del espacio. */
import { exigirUsuarioActual } from "@/lib/identidad";
import { leerCatalogos } from "@/lib/bandeja/consultas";
import { crearEtiqueta, guardarRespuestaRapida } from "@/lib/bandeja/acciones";
import { PALETA_ETIQUETAS } from "@/lib/bandeja/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const usuario = await exigirUsuarioActual();
  const catalogos = await leerCatalogos({
    workspaceId: usuario.workspaceId,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      ...(usuario.avatarUrl ? { avatar: usuario.avatarUrl } : {}),
    },
  });
  return Response.json({ catalogos });
}

type Cuerpo =
  | { tipo: "etiqueta"; nombre: string; color?: string }
  | { tipo: "respuesta"; atajo: string; titulo?: string; cuerpo: string };

export async function POST(peticion: Request) {
  const usuario = await exigirUsuarioActual();
  const cuerpo = (await peticion.json()) as Cuerpo;

  if (cuerpo.tipo === "etiqueta") {
    const nombre = (cuerpo.nombre ?? "").trim();
    if (!nombre) return Response.json({ error: "La etiqueta necesita un nombre." }, { status: 400 });
    // El color sale siempre de la paleta de neutros teñidos: si llegara un
    // semántico desde fuera, se descarta en silencio en favor del primero.
    const color = PALETA_ETIQUETAS.some((c) => c.hex === cuerpo.color)
      ? (cuerpo.color as string)
      : (PALETA_ETIQUETAS[0]?.hex ?? "#64748B");
    const etiqueta = await crearEtiqueta({ workspaceId: usuario.workspaceId, nombre, color });
    return Response.json({ etiqueta });
  }

  if (cuerpo.tipo === "respuesta") {
    const respuesta = await guardarRespuestaRapida({
      workspaceId: usuario.workspaceId,
      usuarioId: usuario.id,
      atajo: cuerpo.atajo ?? "",
      titulo: cuerpo.titulo ?? "",
      cuerpo: cuerpo.cuerpo ?? "",
    });
    if (!respuesta) return Response.json({ error: "Falta el atajo." }, { status: 400 });
    return Response.json({ respuesta });
  }

  return Response.json({ error: "No sé crear eso." }, { status: 400 });
}
