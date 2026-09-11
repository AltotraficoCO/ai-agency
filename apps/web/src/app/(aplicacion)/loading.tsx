/**
 * Lo que se ve mientras llega una pantalla.
 *
 * Solo ocupa la zona de la derecha: el menú está en el layout y no se mueve.
 * Se pinta al instante, así el clic se nota aunque la pantalla nueva tarde en
 * consultar la base.
 */
import { Skeleton } from "@strappy/ui";

export default function Cargando() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Cargando">
      <div className="flex h-[52px] shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
