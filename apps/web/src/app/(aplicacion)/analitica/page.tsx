import { Card, CardBody, CardHeader, CardTitle, CardDescription, Tabs, TabsContent, TabsList, TabsTrigger } from "@strappy/ui";
import { MarcoApp } from "@/components/marco-app";
import { datosDelMarco } from "@/lib/marco";
import { SelectorFechas } from "@/components/negocio/selector-fechas";
import { TarjetaIndicador } from "@/components/negocio/tarjeta-indicador";
import { BannerCreditos } from "@/components/negocio/banner-creditos";
import { analiticaDeStrappy } from "@/lib/negocio/analitica";
import { gastoEnMeta } from "@/lib/negocio/meta";
import { ajustesDelEspacio, estadoDelNegocio } from "@/lib/negocio/cartera";
import { rangoDesdeParametros } from "@/lib/negocio/fechas";
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
      contexto={<SelectorFechas rango={rango} atajo={atajo} />}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <BannerCreditos estado={negocio.cartera.estado} proyeccion={negocio.cartera.proyeccion} />

        <Tabs defaultValue={pestana}>
          <TabsList>
            <TabsTrigger value="conversaciones">Conversaciones</TabsTrigger>
            <TabsTrigger value="rendimiento">Rendimiento</TabsTrigger>
            <TabsTrigger value="consumo">Consumo</TabsTrigger>
          </TabsList>

          <TabsContent value="conversaciones" className="pt-5">
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {analitica.indicadores.map((i) => (
                  <TarjetaIndicador key={i.clave} indicador={i} />
                ))}
              </div>
              <PestanaConversaciones analitica={analitica} />
            </div>
          </TabsContent>

          <TabsContent value="rendimiento" className="pt-5">
            <PestanaRendimiento analitica={analitica} />
          </TabsContent>

          <TabsContent value="consumo" className="pt-5">
            <PestanaConsumo analitica={analitica} negocio={negocio} meta={meta} />
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle>Cómo leer estos números</CardTitle>
            <CardDescription>
              Lo que ves aquí son tus conversaciones y tus créditos de IA. El gasto de mensajería de
              WhatsApp te lo cobra Meta directamente y aparece por separado, en la pestaña de Consumo.
            </CardDescription>
          </CardHeader>
          <CardBody className="text-sm text-fg-secondary">
            1 crédito ≈ una respuesta corta de la IA. 1.000 créditos = 1 USD.
          </CardBody>
        </Card>
      </div>
    </MarcoApp>
  );
}
