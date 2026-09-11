"use client";

/**
 * Conectar el WordPress que cuida el Webmaster.
 *
 * Mismo patrón que los demás formularios de ajustes: acción de servidor y
 * `useActionState`. La contraseña nunca vuelve al navegador: el campo sale
 * siempre vacío, también al editar un sitio ya conectado.
 */
import { useActionState } from "react";
import { Button, Input } from "@strappy/ui";
import type { Resultado } from "@/lib/negocio/acciones";

export function FormularioSitio({
  accion,
  url,
  usuario,
  puedeEditar,
}: {
  accion: (datos: FormData) => Promise<Resultado>;
  url: string;
  usuario: string;
  puedeEditar: boolean;
}) {
  const [estado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => accion(datos),
    null,
  );

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-4" disabled={!puedeEditar}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Dirección del sitio</span>
          <Input name="url" inputMode="url" placeholder="https://misitio.com" defaultValue={url} required />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Usuario de WordPress</span>
          <span className="text-2xs text-fg-muted">
            Un administrador del sitio. Lo que el Webmaster pueda hacer depende de los permisos de este usuario.
          </span>
          <Input name="usuario" autoComplete="username" defaultValue={usuario} required />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Contraseña de aplicación</span>
          <span className="text-2xs text-fg-muted">
            No es tu contraseña normal. Créala en WordPress: Usuarios → tu perfil → «Contraseñas de aplicación».
            Puedes revocarla ahí mismo cuando quieras.
          </span>
          <Input name="contrasena" type="password" autoComplete="off" required />
        </label>
      </fieldset>

      {estado && (
        <p className={`text-sm ${estado.ok ? "text-success-fg" : "text-danger-fg"}`} role="status">
          {estado.ok ? estado.mensaje : estado.error}
        </p>
      )}

      <div>
        <Button type="submit" loading={pendiente} disabled={!puedeEditar}>
          {url ? "Probar y actualizar" : "Probar y conectar"}
        </Button>
      </div>
    </form>
  );
}
