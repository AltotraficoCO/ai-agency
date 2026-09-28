/**
 * Usuarios · siempre sensibles: quien entra al sitio no lo decide un modelo.
 */
import { z } from "zod";
import { defineTool } from "@strappy/tools";
import { SCOPES } from "../../context.js";
import { entorno } from "../comun.js";
import { requireWp } from "../../ports.js";
import { puertaDeAprobacion, type Bloqueo } from "../../aprobacion.js";
import * as wp from "../../wordpress/client.js";

export const wpCrearUsuario = defineTool({
  slug: "wp_crear_usuario",
  label: "Crear un usuario",
  description:
    "Crea un usuario del sitio con un rol. La contraseña la genera la plataforma y el dueño debe cambiarla.",
  whenToUse: "solo si el cliente pidió dar acceso a alguien concreto",
  inputSchema: z.object({
    username: z.string().min(3).max(60).regex(/^[a-z0-9._-]+$/i),
    // A mano y no con `z.email()`: su JSON Schema lleva una expresion regular
    // con comprobaciones hacia delante `(?!`, que OpenAI rechaza. Una sola
    // herramienta invalida tumba TODA la peticion con «Provider returned
    // error», sin decir cual es. Lo vigila `test/esquemas.test.ts`.
    email: z
      .string()
      .min(5)
      .max(254)
      .regex(/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/, "Escribe un correo valido, por ejemplo ana@negocio.com"),
    role: z.enum(["subscriber", "contributor", "author", "editor", "administrator"]),
  }),
  sensitive: true,
  creditCost: 5,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_crear_usuario");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_crear_usuario", input, {
      sensible: true,
      motivo: `da acceso "${input.role}" al sitio a ${input.username}`,
    });
    if (bloqueo) return bloqueo;
    const u = await wp.crearUsuario(requireWp(sitio, "wp_crear_usuario"), input, opciones);
    // La contraseña se devuelve bajo una clave que el filtro de secretos borra
    // antes de persistir o enseñar nada: el modelo no debe verla nunca.
    return { id: u.id, username: input.username, role: input.role, password: u.password };
  },
  simulate(_ctx, input) {
    return { simulado: true, username: input.username, role: input.role };
  },
});

export const wpCambiarRolUsuario = defineTool({
  slug: "wp_cambiar_rol_usuario",
  label: "Cambiar el rol de un usuario",
  description: "Cambia el rol de un usuario existente del sitio.",
  whenToUse: "solo si el cliente lo pidió: subir a administrador es dar las llaves del sitio",
  inputSchema: z.object({
    usuario_id: z.number().int().positive(),
    role: z.enum(["subscriber", "contributor", "author", "editor", "administrator"]),
  }),
  sensitive: true,
  creditCost: 5,
  scopes: [SCOPES.wpAdmin],
  effect: "write_external",
  kind: "http",
  async execute(ctx, input): Promise<Bloqueo | Record<string, unknown>> {
    const { sitio, opciones } = entorno(ctx, "wp_cambiar_rol_usuario");
    const bloqueo = await puertaDeAprobacion(ctx, sitio, "wp_cambiar_rol_usuario", input, {
      sensible: true,
      motivo: `cambia el rol del usuario ${input.usuario_id} a "${input.role}"`,
    });
    if (bloqueo) return bloqueo;
    await wp.cambiarRolUsuario(
      requireWp(sitio, "wp_cambiar_rol_usuario"),
      input.usuario_id,
      input.role,
      opciones,
    );
    return { ok: true, usuario_id: input.usuario_id, role: input.role };
  },
  simulate(_ctx, input) {
    return { simulado: true, usuario_id: input.usuario_id, role: input.role };
  },
});
