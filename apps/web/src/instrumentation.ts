/**
 * Se ejecuta una vez al arrancar el servidor, antes de la primera petición.
 *
 * Carga los ajustes del panel para que la clave de la cartera de modelos
 * guardada ahí esté en el entorno desde el principio: el motor la lee de ahí
 * y de forma síncrona, así que no puede esperar a que una pantalla la traiga.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { prepararAjustes } = await import("@/lib/plataforma/config");
  await prepararAjustes();
}
