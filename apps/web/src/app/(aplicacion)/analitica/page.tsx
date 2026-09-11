import { Coins, Gauge, Info, MessagesSquare } from "lucide-react";
import { EncabezadoPagina, Tabs, TabsContent, TabsList, TabsTrigger } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";
import { SelectorFechas } from "@/components/negocio/selector-fechas";
import { TarjetaIndicador } from "@/components/negocio/tarjeta-indicador";
import { BannerCreditos } from "@/components/negocio/banner-creditos";
import { analiticaDeStrappy } from "@/lib/negocio/analitica";
import { gastoEnMeta } from "@/lib/negocio/meta";
import { ajustesDelEspacio, estadoDelNegocio } from "@/lib/negocio/cartera";
import { etiquetaDeRango, rangoDesdeParametros } from "@/lib/negocio/fechas";
import { PestanaConversaciones } from "./pestana-conversaciones";
import { PestanaRendimiento } from "./pestana-rendimiento";
import { PestanaConsumo } from "./pestana-consumo";

export const metadata = { title: "Analítica" };

// Cifras del día en curso: no hay nada que prerenderizar.
export const dynamic = "force-dynamic";

type Parametros = Promise<{ atajo?: string; desde?: string; hasta?: string; pestana?: string }>;

export default async function PaginaAnalitica({ searchParams }: { searchParams: Parametros }) {
  const parametros = await searchParams;
  const marco = await datosDelMarco();
  const espacio = await ajustesDelEspacio(marco.actual.workspaceId);

  const { rango, atajo } = rangoDesdeParametros(parametros, new Date(), espacio.zonaHoraria);

  // Las tres lecturas van en paralelo y NO se mezclan: `analitica` son créditos
  // nuestros, `meta` son dólares que cobra Meta, y `negocio` es el plan.
  const [analitica, meta, negocio] = await Promise.all([
    analiticaDeStrappy(marco.actual.workspaceId, rango),
    gastoEnMeta(marco.actual.workspaceId, rango, espacio.zonaHoraria),
    estadoDelNegocio(marco.actual.workspaceId),
  ]);

  const pestana = ["conversaciones", "rendimiento", "consumo"].includes(parametros.pestana ?? "")
    ? (parametros.pestana as string)
    : "conversaciones";

  return (
    <MarcoApp
      usuario={marco.usuario}
      creditos={marco.creditos}
      pendientes={marco.pendientes}
      titulo="Analítica"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        {/* El periodo va con las acciones del encabezado, no apretado en la
            barra superior: es lo primero que se cambia en esta pantalla. */}
        <EncabezadoPagina
          titulo="Analítica"
          descripcion={`${etiquetaDeRango(rango)} · Cuánto atienden tus agentes, qué resuelven solos y cuánto cuesta.`}
          acciones={<SelectorFechas rango={rango} atajo={atajo} />}
        />

        <BannerCreditos estado={negocio.cartera.estado} proyeccion={negocio.cartera.proyeccion} />

        <Tabs defaultValue={pestana}>
          <TabsList className="overflow-x-auto">
            <TabsTrigger value="conversaciones">
              <MessagesSquare size={16} strokeWidth={1.75} aria-hidden />
              Conversaciones
            </TabsTrigger>
            <TabsTrigger value="rendimiento">
              <Gauge size={16} strokeWidth={1.75} aria-hidden />
              Rendimiento
            </TabsTrigger>
            <TabsTrigger value="consumo">
              <Coins size={16} strokeWidth={1.75} aria-hidden />
              Consumo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="conversaciones" className="pt-6">
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {analitica.indicadores.map((i) => (
                  <TarjetaIndicador key={i.clave} indicador={i} />
                ))}
              </div>
              <PestanaConversaciones analitica={analitica} />
            </div>
          </TabsContent>

          <TabsContent value="rendimiento" className="pt-6">
            <PestanaRendimiento analitica={analitica} />
          </TabsContent>

          <TabsContent value="consumo" className="pt-6">
            <PestanaConsumo analitica={analitica} negocio={negocio} meta={meta} />
          </TabsContent>
        </Tabs>

        <p className="flex items-start gap-2.5 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-fg-secondary">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
          <span>
            <strong className="font-medium text-fg">Cómo leer estos números.</strong> 1 crédito ≈ una respuesta
            corta de la IA; 1.000 créditos = 1 USD. Lo que Meta te cobra por WhatsApp va aparte, en la pestaña
            Consumo.
          </span>
        </p>
      </div>
    </MarcoApp>
  );
}
