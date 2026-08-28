import Link from "next/link";
import { Strap } from "@strappy/ui";

/** Pantallas de acceso: sin menú, sin barra, sin nada que distraiga. */
export default function LayoutAcceso({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Strap pose="saludando" size={88} breathe />
          <Link href="/" className="text-xl font-semibold tracking-tight text-fg">
            Strappy
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
