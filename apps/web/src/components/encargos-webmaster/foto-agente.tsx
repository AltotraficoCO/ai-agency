import Image from "next/image";
import { cn } from "@strappy/ui";

/** La foto del Webmaster en círculo. Mientras trabaja, un aro verde late alrededor. */
export function FotoAgente({
  src,
  size,
  trabajando,
}: {
  src: string;
  size: number;
  trabajando: boolean;
}) {
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {trabajando ? (
        <span
          aria-hidden
          className="absolute -inset-1 animate-ping rounded-full border-2 border-primary/60 motion-reduce:animate-none"
        />
      ) : null}
      <span
        className={cn(
          "relative size-full overflow-hidden rounded-full border-2 bg-[radial-gradient(circle_at_50%_30%,#123a3a_0%,#0b2224_75%)] shadow-e2",
          trabajando ? "border-primary" : "border-[var(--border-default)]",
        )}
      >
        <Image
          src={src}
          alt=""
          width={size * 3}
          height={size * 3}
          className="absolute left-1/2 top-[4%] h-auto w-[150%] max-w-none -translate-x-1/2"
        />
      </span>
    </span>
  );
}
