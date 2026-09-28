/**
 * Lector del tarball que da GitHub, sin dependencias.
 *
 * Solo lo que hace falta para ese formato: cabeceras ustar, nombres largos en
 * cabeceras pax ('x') o GNU ('L') y la cabecera pax global con el commit. Los
 * enlaces simbólicos y los directorios se ignoran: el agente edita archivos.
 */
import { gunzipSync } from "node:zlib";

export type EntradaTar = {
  /** Ruta dentro del repositorio, ya sin la carpeta raíz «owner-repo-sha/». */
  readonly ruta: string;
  readonly modo: string;
  readonly bytes: Uint8Array;
};

export type Tarball = {
  /** El commit del que salió, si GitHub lo anotó en la cabecera global. */
  readonly commit: string | null;
  readonly archivos: readonly EntradaTar[];
};

const decodificador = new TextDecoder();

function cadena(b: Uint8Array, desde: number, largo: number): string {
  const trozo = b.subarray(desde, desde + largo);
  const fin = trozo.indexOf(0);
  return decodificador.decode(fin === -1 ? trozo : trozo.subarray(0, fin));
}

function octal(b: Uint8Array, desde: number, largo: number): number {
  const t = cadena(b, desde, largo).trim();
  return t ? Number.parseInt(t, 8) : 0;
}

/** Registros «longitud clave=valor\n» de una cabecera pax. */
function pax(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const texto = decodificador.decode(bytes);
  let i = 0;
  while (i < texto.length) {
    const espacio = texto.indexOf(" ", i);
    if (espacio === -1) break;
    const largo = Number.parseInt(texto.slice(i, espacio), 10);
    if (!Number.isFinite(largo) || largo <= 0) break;
    const registro = texto.slice(espacio + 1, i + largo - 1);
    const igual = registro.indexOf("=");
    if (igual > 0) out[registro.slice(0, igual)] = registro.slice(igual + 1);
    i += largo;
  }
  return out;
}

export function leerTarball(comprimido: Uint8Array): Tarball {
  const b = new Uint8Array(gunzipSync(comprimido));
  const archivos: EntradaTar[] = [];
  let commit: string | null = null;
  let nombreLargo: string | null = null;
  let i = 0;

  while (i + 512 <= b.length) {
    const cabecera = b.subarray(i, i + 512);
    if (cabecera.every((x) => x === 0)) break;
    const tamano = octal(cabecera, 124, 12);
    const tipo = String.fromCharCode(cabecera[156] ?? 0);
    const prefijo = cadena(cabecera, 345, 155);
    const nombre = cadena(cabecera, 0, 100);
    const modo = cadena(cabecera, 100, 8).trim();
    const datos = b.subarray(i + 512, i + 512 + tamano);
    i += 512 + Math.ceil(tamano / 512) * 512;

    if (tipo === "g") {
      commit = pax(datos).comment ?? commit;
      continue;
    }
    if (tipo === "x") {
      nombreLargo = pax(datos).path ?? null;
      continue;
    }
    if (tipo === "L") {
      nombreLargo = cadena(datos, 0, datos.length);
      continue;
    }

    const completo = nombreLargo ?? (prefijo ? `${prefijo}/${nombre}` : nombre);
    nombreLargo = null;
    if (tipo !== "0" && tipo !== "\0") continue;

    // GitHub mete todo bajo «owner-repo-sha/».
    const barra = completo.indexOf("/");
    const ruta = barra === -1 ? completo : completo.slice(barra + 1);
    if (!ruta) continue;
    // Un 7 en los permisos del dueño es ejecutable; el resto, archivo normal.
    const ejecutable = /[1357]..$/.test(modo.slice(-3));
    archivos.push({ ruta, modo: ejecutable ? "100755" : "100644", bytes: datos.slice() });
  }

  return { commit, archivos };
}
