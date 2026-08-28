"use client";

/**
 * Contratar un agente en cuatro pasos.
 *
 *   1. Elegir        — confirmar qué hace y qué cuesta.
 *   2. Conectar      — lo que le falta al espacio para que sirva de algo.
 *   3. Personalizar  — 3-5 campos. TODO lo demás se hereda de la ficha de
 *                      empresa (`company_profiles`), que se rellena una vez.
 *   4. Probar        — el agente se crea en BORRADOR y el botón lleva al
 *                      simulador.
 *
 * El cuarto paso no es un adorno. Publicar sin probar es lo que hace que un
 * agente mal configurado le conteste a un cliente real, y esa primera respuesta
 * mala cuesta más que todo lo que ahorró el asistente.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Stepper,
  Textarea,
} from "@strappy/ui";
import { accionContratar } from "@/lib/negocio/acciones";
import { dolares } from "@/lib/negocio/creditos";
import type { FichaCatalogo } from "@/lib/negocio/catalogo";

const PASOS = [
  { id: "elegir", label: "Elegir", description: "Qué hace y qué cuesta" },
  { id: "conectar", label: "Conectar", description: "Lo que le falta" },
  { id: "personalizar", label: "Personalizar", description: "Tres o cuatro cosas" },
  { id: "probar", label: "Probar", description: "Antes de publicarlo" },
];

export function AsistenteContratacion({ ficha }: { ficha: FichaCatalogo }) {
  const router = useRouter();
  const [paso, setPaso] = React.useState(0);
  const [valores, setValores] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(ficha.campos.map((c) => [c.clave, c.valorPorDefecto])),
  );
  const [nombre, setNombre] = React.useState(ficha.nombre);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [agenteId, setAgenteId] = React.useState<string | null>(ficha.agenteId);

  const faltanConexiones = ficha.conexiones.filter((c) => !c.lista);

  async function contratar() {
    setEnviando(true);
    setError(null);
    const datos = new FormData();
    datos.set("slug", ficha.slug);
    datos.set("nombre", nombre);
    for (const [clave, valor] of Object.entries(valores)) datos.set(`campo_${clave}`, valor);

    const resultado = await accionContratar(datos);
    setEnviando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    const id = resultado.destino?.split("/")[2] ?? null;
    setAgenteId(id);
    setPaso(3);
  }

  return (
    <div className="flex flex-col gap-5">
      <Stepper steps={PASOS} current={paso} />

      {paso === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{ficha.nombre}</CardTitle>
            <CardDescription>{ficha.tagline}</CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-fg-secondary">{ficha.descripcion}</p>

            <div>
              <h3 className="mb-1.5 text-sm font-medium text-fg">Qué sabe hacer</h3>
              <ul className="flex flex-wrap gap-1">
                {ficha.herramientas.map((h) => (
                  <li key={h.slug}>
                    <Badge tone="ia">{h.nombre}</Badge>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">Coste fijo al mes</dt>
                <dd className="text-fg">
                  {ficha.creditosMensuales > 0
                    ? `${dolares(ficha.costeUsd)} además de tu plan`
                    : "Incluido en tu plan"}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Consumo</dt>
                <dd className="text-fg">
                  Créditos de IA según lo que trabaje. Los mensajes de WhatsApp los cobra Meta.
                </dd>
              </div>
            </dl>

            <div className="flex gap-2">
              <Button onClick={() => setPaso(1)}>Continuar</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {paso === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Lo que necesita conectado</CardTitle>
            <CardDescription>
              Puedes contratarlo igual y conectar lo que falte después, pero no atenderá a nadie hasta
              que esté todo.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {ficha.conexiones.map((c) => (
                <li
                  key={c.clave}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{c.nombre}</p>
                    <p className="text-2xs text-fg-muted">{c.descripcion}</p>
                  </div>
                  {c.lista ? (
                    <Badge tone="exito">Listo</Badge>
                  ) : (
                    <a
                      href={c.ruta}
                      className="text-sm text-primary-fg underline decoration-dotted underline-offset-4"
                    >
                      Conectar
                    </a>
                  )}
                </li>
              ))}
              {ficha.conexiones.length === 0 && (
                <li className="text-sm text-fg-muted">Este agente no necesita nada conectado.</li>
              )}
            </ul>

            {faltanConexiones.length > 0 && (
              <p className="rounded-lg bg-warning-soft px-3 py-2 text-2xs text-warning-fg">
                Te falta {faltanConexiones.map((c) => c.nombre).join(", ")}. Puedes seguir y conectarlo
                más tarde.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPaso(0)}>
                Atrás
              </Button>
              <Button onClick={() => setPaso(2)}>Continuar</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {paso === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Ajústalo a tu negocio</CardTitle>
            <CardDescription>
              Solo esto. El nombre de tu empresa, tu horario, tu tono y tus políticas los hereda de la
              ficha de tu espacio: no hay que repetirlos por cada agente.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-fg">Nombre del agente</span>
              <span className="text-2xs text-fg-muted">Cómo lo verás tú en tu panel.</span>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </label>

            {ficha.campos.map((campo) => (
              <label key={campo.clave} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-fg">{campo.etiqueta}</span>
                <span className="text-2xs text-fg-muted">{campo.ayuda}</span>
                {campo.tipo === "parrafo" ? (
                  <Textarea
                    rows={3}
                    value={valores[campo.clave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.clave]: e.target.value }))}
                  />
                ) : campo.tipo === "opcion" ? (
                  <select
                    className="h-9 rounded-md border border-border bg-raised px-2 text-base text-fg"
                    value={valores[campo.clave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.clave]: e.target.value }))}
                  >
                    {(campo.opciones ?? []).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={valores[campo.clave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.clave]: e.target.value }))}
                  />
                )}
              </label>
            ))}

            {error && <p className="text-sm text-danger-fg">{error}</p>}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPaso(1)}>
                Atrás
              </Button>
              <Button onClick={contratar} loading={enviando} loadingLabel="Creando el agente…">
                Crear y probar
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {paso === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Pruébalo antes de publicarlo</CardTitle>
            <CardDescription>
              Tu agente ya existe, en borrador. Todavía no habla con nadie: escríbele tú primero y
              publícalo cuando te convenza.
            </CardDescription>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            <Button
              onClick={() => router.push(agenteId ? `/agentes/${agenteId}/probar` : "/agentes")}
            >
              Probar el agente
            </Button>
            <Button variant="secondary" onClick={() => router.push("/contratar")}>
              Volver al catálogo
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
