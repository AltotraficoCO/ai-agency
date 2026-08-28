import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { EnlaceBoton } from "@/components/enlace-boton";
import { datosDelMarco } from "@/lib/marco";
import { catalogoDelEspacio } from "@/lib/negocio/catalogo";
import { dolares } from "@/lib/negocio/creditos";

export const metadata = { title: "Contratar agente" };
export const dynamic = "force-dynamic";

/**
 * El catálogo.
 *
 * Cada ficha dice tres cosas y en este orden: QUÉ HACE, QUÉ CUESTA y QUÉ
 * NECESITA CONECTADO. Ese tercer punto es el que evita la decepción: contratar
 * un recepcionista sin WhatsApp conectado deja al cliente con un agente que no
 * atiende a nadie y con la sensación de que el producto no funciona.
 */
export default async function PaginaContratar() {
  const marco = await datosDelMarco();
  const catalogo = await catalogoDelEspacio(marco.actual.workspaceId);

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Contratar agente"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-fg">
            Agentes listos para trabajar
          </h2>
          <p className="max-w-[70ch] text-sm text-fg-secondary">
            Ya vienen construidos y saben hacer su trabajo. Tú eliges cuál, conectas lo que falte,
            ajustas tres o cuatro cosas y lo pruebas antes de que hable con nadie.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalogo.map((ficha) => (
            <Card key={ficha.slug} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle>{ficha.nombre}</CardTitle>
                  <CardDescription>{ficha.tagline}</CardDescription>
                </div>
                {ficha.contratado && <Badge tone="exito">Contratado</Badge>}
              </CardHeader>
              <CardBody className="flex flex-1 flex-col gap-3">
                <p className="text-sm text-fg-secondary">{ficha.descripcion}</p>

                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-fg-muted">Al mes</dt>
                    <dd className="text-fg">
                      {ficha.creditosMensuales > 0
                        ? `${dolares(ficha.costeUsd)} fijos`
                        : "Incluido en tu plan"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <dt className="shrink-0 text-fg-muted">Necesita</dt>
                    <dd className="text-right text-fg">
                      {ficha.conexiones.length === 0
                        ? "Nada más"
                        : ficha.conexiones.map((c) => c.nombre).join(" · ")}
                    </dd>
                  </div>
                </dl>

                <ul className="flex flex-wrap gap-1">
                  {ficha.conexiones.map((c) => (
                    <li key={c.clave}>
                      <Badge tone={c.lista ? "exito" : "aviso"}>
                        {c.nombre}: {c.lista ? "listo" : "por conectar"}
                      </Badge>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex gap-2 pt-2">
                  <EnlaceBoton href={`/contratar/${ficha.slug}`} size="sm">
                    {ficha.contratado ? "Ver ficha" : "Contratar"}
                  </EnlaceBoton>
                  {ficha.contratado && ficha.agenteId && (
                    <EnlaceBoton href={`/agentes/${ficha.agenteId}`} variant="ghost" size="sm">
                      Abrir agente
                    </EnlaceBoton>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <p className="text-2xs text-fg-muted">
          El consumo de estos agentes se cobra en créditos de IA, como el de los tuyos. Los mensajes de
          WhatsApp los cobra Meta directamente a tu cuenta.
        </p>
      </div>
    </MarcoApp>
  );
}
