"use client";

/**
 * Recargar créditos y dejar la recarga automática configurada.
 *
 * El importe en pesos que se enseña es una estimación con la TRM de hoy; el
 * definitivo lo cotiza el servidor al pulsar y es el que Wompi muestra antes de
 * pagar.
 */
import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { CreditCard } from "lucide-react";
import {
  cotizar,
  creditosPorUsd,
  validarMonto,
  type ConfigCobro,
} from "@strappy/core/recargas";
import type { TokensDeAceptacion } from "@strappy/core/wompi";
import { Button, Input, cn } from "@strappy/ui";
import { creditosCompactos } from "@/lib/negocio/creditos";
import type { Resultado } from "@/lib/negocio/acciones";
import type { RecargaAutomatica } from "@/lib/negocio/facturacion";
import { AvisoAjustes } from "./seccion-ajustes";

const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function Equivalencia({ usd, trm, config }: { usd: number; trm: number | null; config: ConfigCobro }) {
  const monto = validarMonto(usd, config);
  if (!monto.ok) return <p className="text-2xs text-fg-muted">{monto.motivo}</p>;
  return (
    <p className="text-sm text-fg-secondary">
      <strong className="font-medium text-fg tabular-nums">{creditosCompactos(creditosPorUsd(monto.usd))}</strong> créditos
      {trm !== null && (
        <>
          {" · unos "}
          <span className="tabular-nums">{PESOS.format(cotizar(monto.usd, trm).pesos)}</span> a la TRM de hoy
        </>
      )}
    </p>
  );
}

export function FormularioRecarga({
  trm,
  puedeEditar,
  config,
}: {
  trm: number | null;
  puedeEditar: boolean;
  config: ConfigCobro;
}) {
  const [valor, setValor] = React.useState("50");
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const usd = Number(valor);

  async function pagar(evento: React.FormEvent) {
    evento.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/wompi/recarga", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usd }),
      });
      const datos = (await respuesta.json()) as { url?: string; error?: string };
      if (datos.url) {
        window.location.href = datos.url;
        return;
      }
      setError(datos.error ?? "No se pudo iniciar el pago.");
    } catch {
      setError("No se pudo contactar con la pasarela de pago.");
    }
    setCargando(false);
  }

  return (
    <form onSubmit={pagar} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-usd`} className="text-sm font-medium text-fg">
          Monto en dólares
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`${id}-usd`}
            type="number"
            min={config.minimoUsd}
            max={config.maximoUsd}
            step={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={!puedeEditar}
            className="w-32"
          />
          {puedeEditar && (
            <Button type="submit" loading={cargando} loadingLabel="Abriendo Wompi…" disabled={!validarMonto(usd, config).ok}>
              Recargar con Wompi
            </Button>
          )}
        </div>
        <p className="text-2xs text-fg-muted">
          Desde {config.minimoUsd} USD. Se cobra en pesos a la TRM del día; verás el valor exacto antes de pagar.
        </p>
      </div>
      <Equivalencia usd={usd} trm={trm} config={config} />
      {error && <AvisoAjustes tono="error">{error}</AvisoAjustes>}
    </form>
  );
}

// ── Recarga automática ──────────────────────────────────────────────────────

type WidgetDeWompi = new (config: { publicKey: string; widgetOperation: "tokenize" }) => {
  open(alTerminar: (resultado: { payment_source?: { token?: string } }) => void): void;
};

const MOTIVOS: Record<string, string> = {
  tarjeta_rechazada: "Se apagó sola porque tu tarjeta fue rechazada varias veces seguidas. Revísala y vuelve a encenderla.",
  tope_diario: "Se apagó sola porque hubo demasiadas recargas automáticas en 24 horas. Revisa el consumo antes de encenderla de nuevo.",
};

export function RecargaAutomaticaPanel({
  estado,
  llavePublica,
  contratos,
  trm,
  config,
  puedeEditar,
  guardar,
  olvidar,
}: {
  estado: RecargaAutomatica;
  llavePublica: string | null;
  contratos: TokensDeAceptacion | null;
  trm: number | null;
  config: ConfigCobro;
  puedeEditar: boolean;
  guardar: (datos: FormData) => Promise<Resultado>;
  olvidar: () => Promise<Resultado>;
}) {
  const esFijo = config.montosAutomaticos.includes(estado.usd);
  const [opcion, setOpcion] = React.useState<string>(esFijo ? String(estado.usd) : "propio");
  const [propio, setPropio] = React.useState(esFijo ? "" : String(estado.usd));
  const [activa, setActiva] = React.useState(estado.activa);
  const [resultado, enviar, pendiente] = useActionState<Resultado | null, FormData>(
    async (_previo, datos) => guardar(datos),
    null,
  );
  const monto = opcion === "propio" ? Number(propio) : Number(opcion);

  return (
    <div className="flex flex-col gap-5">
      {estado.motivoApagado && (
        <AvisoAjustes tono="error">{MOTIVOS[estado.motivoApagado] ?? "La recarga automática se apagó sola."}</AvisoAjustes>
      )}

      <RegistroDeTarjeta
        tarjeta={estado.tarjeta}
        llavePublica={llavePublica}
        contratos={contratos}
        puedeEditar={puedeEditar}
        olvidar={olvidar}
      />

      {estado.tarjeta && (
        <form action={enviar} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={!puedeEditar}>
            <legend className="mb-1 text-sm font-medium text-fg">Cuánto recargar cada vez</legend>
            <div className="flex flex-wrap gap-2">
              {[...config.montosAutomaticos.map(String), "propio"].map((clave) => (
                <label
                  key={clave}
                  className={cn(
                    "cursor-pointer rounded-md border border-border bg-page px-3 py-1.5 text-sm text-fg-secondary transition-colors duration-[var(--dur-fast)]",
                    "hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-fg",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--border-focus)]",
                  )}
                >
                  <input
                    type="radio"
                    name="opcion"
                    value={clave}
                    checked={opcion === clave}
                    onChange={() => setOpcion(clave)}
                    className="sr-only"
                  />
                  {clave === "propio" ? "Otro monto" : `$${clave}`}
                </label>
              ))}
            </div>
            {opcion === "propio" && (
              <Input
                type="number"
                aria-label="Monto propio en dólares"
                min={config.minimoUsd}
                max={config.maximoUsd}
                step={1}
                value={propio}
                onChange={(e) => setPropio(e.target.value)}
                placeholder={`Desde ${config.minimoUsd} USD`}
                className="w-40"
              />
            )}
            <input type="hidden" name="monto" value={Number.isNaN(monto) ? "" : monto} />
            <Equivalencia usd={monto} trm={trm} config={config} />
          </fieldset>

          <label className="flex items-center gap-2 text-sm font-medium text-fg">
            <input
              type="checkbox"
              name="activa"
              checked={activa}
              onChange={(e) => setActiva(e.target.checked)}
              disabled={!puedeEditar}
              className="size-4 accent-[var(--brand)]"
            />
            Recargar automáticamente al acabarse el saldo
          </label>

          {activa && !estado.activa && (
            <label className="flex items-start gap-2 text-sm text-fg-secondary">
              <input type="checkbox" name="autorizo" required className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
              <span>
                Autorizo a Strappy a cargar a {estado.tarjeta} el monto elegido, en pesos a la TRM del día, cada vez que
                se acabe mi saldo, hasta que apague esta opción.
              </span>
            </label>
          )}
          {/* Ya autorizada, cambiar el monto no vuelve a pedir la casilla: se guarda con la misma constancia. */}
          {activa && estado.activa && <input type="hidden" name="autorizo" value="on" />}

          {resultado && (
            <AvisoAjustes tono={resultado.ok ? "exito" : "error"}>
              {resultado.ok ? resultado.mensaje : resultado.error}
            </AvisoAjustes>
          )}
          {puedeEditar && (
            <div>
              <Button type="submit" loading={pendiente} loadingLabel="Guardando…" disabled={!validarMonto(monto, config).ok}>
                Guardar
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function RegistroDeTarjeta({
  tarjeta,
  llavePublica,
  contratos,
  puedeEditar,
  olvidar,
}: {
  tarjeta: string | null;
  llavePublica: string | null;
  contratos: TokensDeAceptacion | null;
  puedeEditar: boolean;
  olvidar: () => Promise<Resultado>;
}) {
  const router = useRouter();
  const [politica, setPolitica] = React.useState(false);
  const [datos, setDatos] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cambiando, setCambiando] = React.useState(false);

  async function registrar(token: string) {
    if (!contratos) return;
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/wompi/tarjeta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          aceptacion: contratos.politica.token,
          datosPersonales: contratos.datosPersonales.token,
        }),
      });
      const cuerpo = (await respuesta.json()) as { error?: string };
      if (!respuesta.ok) {
        setError(cuerpo.error ?? "No se pudo registrar la tarjeta.");
      } else {
        setCambiando(false);
        router.refresh();
      }
    } catch {
      setError("No se pudo contactar con la pasarela de pago.");
    }
    setOcupado(false);
  }

  function abrirWidget() {
    const Widget = (window as unknown as { WidgetCheckout?: WidgetDeWompi }).WidgetCheckout;
    if (!Widget || !llavePublica) {
      setError("El formulario de Wompi no cargó. Recarga la página e inténtalo de nuevo.");
      return;
    }
    new Widget({ publicKey: llavePublica, widgetOperation: "tokenize" }).open((resultado) => {
      const token = resultado.payment_source?.token;
      if (token) void registrar(token);
    });
  }

  if (tarjeta && !cambiando) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-inset px-3.5 py-3">
        <CreditCard size={16} strokeWidth={1.75} className="text-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1 text-sm text-fg">{tarjeta}</span>
        {puedeEditar && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCambiando(true)}>
              Cambiar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm("¿Quitar la tarjeta? La recarga automática se apagará.")) {
                  void olvidar().then(() => router.refresh());
                }
              }}
            >
              Quitar
            </Button>
          </>
        )}
      </div>
    );
  }

  if (!puedeEditar) return <p className="text-sm text-fg-muted">Todavía no hay una tarjeta registrada.</p>;
  if (!llavePublica || !contratos) {
    return <AvisoAjustes>Los pagos aún no están configurados en esta instalación.</AvisoAjustes>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Script src="https://checkout.wompi.co/widget.js" strategy="lazyOnload" />
      <p className="text-sm text-fg-secondary">
        Registras la tarjeta en un formulario de Wompi. Strappy nunca ve el número.
      </p>
      <label className="flex items-start gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={politica}
          onChange={(e) => setPolitica(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        />
        <span>
          Leí y acepto la{" "}
          <a href={contratos.politica.enlace} target="_blank" rel="noreferrer" className="underline">
            política de privacidad de Wompi
          </a>
          .
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={datos}
          onChange={(e) => setDatos(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
        />
        <span>
          Leí y acepto la{" "}
          <a href={contratos.datosPersonales.enlace} target="_blank" rel="noreferrer" className="underline">
            autorización de tratamiento de datos personales
          </a>
          .
        </span>
      </label>
      <div>
        <Button type="button" variant="secondary" loading={ocupado} disabled={!politica || !datos} onClick={abrirWidget}>
          <CreditCard size={14} strokeWidth={2} aria-hidden />
          Registrar tarjeta
        </Button>
      </div>
      {error && <AvisoAjustes tono="error">{error}</AvisoAjustes>}
    </div>
  );
}
