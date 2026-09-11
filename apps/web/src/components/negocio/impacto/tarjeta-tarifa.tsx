"use client";

import * as React from "react";
import { HandCoins, Pencil } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@strappy/ui";
import { accionGuardarTarifaImpacto } from "@/lib/negocio/acciones-impacto";
import {
  MONEDAS,
  TARIFA_POR_DEFECTO,
  esMoneda,
  formatearDinero,
  type AjustesImpacto,
  type Moneda,
} from "@/lib/negocio/impacto-calculo";

/**
 * «Tu tarifa»: cuánto le cuesta al negocio una hora de una persona.
 *
 * Se edita en el sitio, sin ir a Ajustes: es la cifra de la que depende todo
 * el dinero de esta pantalla, y quien la ve mal la quiere cambiar justo aquí.
 * Solo propietarios, administradores y constructores la cambian; el resto la
 * ve. El valor del dólar solo se pide si la moneda no es USD, y es opcional:
 * sin él no hay retorno, pero tampoco un tipo de cambio inventado.
 */
export function TarjetaTarifa({ ajustes, puedeEditar }: { ajustes: AjustesImpacto; puedeEditar: boolean }) {
  const [editando, setEditando] = React.useState(false);
  const [moneda, setMoneda] = React.useState<Moneda>(ajustes.moneda);
  const [tarifa, setTarifa] = React.useState(String(ajustes.tarifaHora));
  const [cambio, setCambio] = React.useState(ajustes.usdAMoneda && ajustes.moneda !== "USD" ? String(ajustes.usdAMoneda) : "");
  const [error, setError] = React.useState<string | null>(null);
  const [pendiente, iniciar] = React.useTransition();

  function abrir() {
    setMoneda(ajustes.moneda);
    setTarifa(String(ajustes.tarifaHora));
    setCambio(ajustes.usdAMoneda && ajustes.moneda !== "USD" ? String(ajustes.usdAMoneda) : "");
    setError(null);
    setEditando(true);
  }

  function cambiarMoneda(valor: string) {
    if (!esMoneda(valor)) return;
    // Si la tarifa era la de partida, se cambia por la de partida de la nueva
    // moneda: 8 pesos la hora no es una tarifa, es un error de conversión.
    if (Number(tarifa) === TARIFA_POR_DEFECTO[moneda]) setTarifa(String(TARIFA_POR_DEFECTO[valor]));
    if (valor === "USD") setCambio("");
    setMoneda(valor);
  }

  function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    const numero = (texto: string) => Number(texto.replace(/\s/g, "").replace(",", "."));
    iniciar(async () => {
      const resultado = await accionGuardarTarifaImpacto({
        tarifaHora: numero(tarifa),
        moneda,
        usdAMoneda: moneda !== "USD" && cambio.trim() !== "" ? numero(cambio) : null,
      });
      if (resultado.ok) setEditando(false);
      else setError(resultado.error);
    });
  }

  return (
    <Card id="tarifa" className="strappy-slide-up scroll-mt-24">
      <CardBody className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <HandCoins size={18} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">Tu tarifa</span>
              <Badge tone={ajustes.personalizada ? "ia" : "neutral"}>
                {ajustes.personalizada ? "La tuya" : "De partida"}
              </Badge>
            </div>
            <span className="text-2xs text-fg-muted">Lo que te costaría una hora de una persona haciendo esto</span>
          </div>
          {puedeEditar && !editando ? (
            <Button variant="ghost" size="sm" onClick={abrir} aria-label="Cambiar la tarifa">
              <Pencil size={14} strokeWidth={1.75} aria-hidden />
              Cambiar
            </Button>
          ) : null}
        </div>

        {!editando ? (
          <div className="flex flex-col gap-1">
            <span className="text-2xl font-semibold tracking-tight text-fg tabular-nums">
              {formatearDinero(ajustes.tarifaHora, ajustes.moneda)}
              <span className="ml-1 text-sm font-normal text-fg-muted">/ hora</span>
            </span>
            {ajustes.moneda !== "USD" ? (
              <span className="text-2xs text-fg-muted">
                {ajustes.usdAMoneda
                  ? `1 USD = ${formatearDinero(ajustes.usdAMoneda, ajustes.moneda)}`
                  : "Sin el valor del dólar no podemos calcular el retorno."}
              </span>
            ) : null}
            {!ajustes.personalizada ? (
              <p className="mt-1 text-2xs text-fg-muted">
                Es una cifra de partida para un asistente o técnico junior. Pon la tuya para que el ahorro sea el de tu
                negocio.
              </p>
            ) : null}
          </div>
        ) : (
          <form onSubmit={guardar} className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label="Por hora" help="Sueldo y cargas de una hora de trabajo">
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={tarifa}
                    onChange={(e) => setTarifa(e.target.value)}
                    autoFocus
                    required
                  />
                )}
              </Field>
              <Field label="Moneda">
                {(props) => (
                  <Select value={moneda} onValueChange={cambiarMoneda}>
                    <SelectTrigger id={props.id} aria-describedby={props["aria-describedby"]}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONEDAS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>

            {moneda !== "USD" ? (
              <Field
                label={`Cuánto vale 1 USD en ${moneda}`}
                optional
                help="Solo para calcular el retorno frente a lo que cuestan los créditos."
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    placeholder="Por ejemplo, 4000"
                    value={cambio}
                    onChange={(e) => setCambio(e.target.value)}
                  />
                )}
              </Field>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={pendiente}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={pendiente}>
                Guardar tarifa
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
