export const metadata = { title: "Cuenta suspendida" };

export default function PaginaCuentaSuspendida() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page px-4">
      <div className="flex max-w-md flex-col gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-fg">Tu cuenta está suspendida</h1>
        <p className="text-base text-fg-secondary">
          Tus agentes están detenidos y tus datos siguen guardados. Escríbenos a{" "}
          <a href="mailto:hola@strappy.io" className="underline">
            hola@strappy.io
          </a>{" "}
          para resolverlo.
        </p>
      </div>
    </main>
  );
}
