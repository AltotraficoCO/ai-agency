"use client";

/**
 * Muestrario provisional del sistema de diseño.
 * Se sustituirá por el chat del meta-agente; existe solo para revisar
 * visualmente cada componente y cada estado en los dos temas.
 */

import * as React from "react";
import {
  Bell,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AppShell,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  CreditsWidget,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  Input,
  Kbd,
  Modal,
  ModalClose,
  ModalContent,
  ModalTrigger,
  Pagination,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioField,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  Separator,
  Sidebar,
  Skeleton,
  Slider,
  Spinner,
  Stepper,
  Strap,
  strapAlt,
  strapPoses,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tag,
  Textarea,
  ThemeToggle,
  ToggleField,
  Tooltip,
  Topbar,
  toast,
  rutas,
} from "@strappy/ui";

/** Enlace inerte: el muestrario no tiene rutas todavía. */
function EnlaceDemo(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href="#" onClick={(event) => event.preventDefault()} />;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight text-fg">{titulo}</h2>
      <div className="rounded-xl border border-border bg-raised p-5">{children}</div>
    </section>
  );
}

function Fila({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export default function Muestrario() {
  const [segmento, setSegmento] = React.useState<"todas" | "ia" | "humano">("todas");
  const [filtroActivo, setFiltroActivo] = React.useState(true);
  const [pagina, setPagina] = React.useState(3);
  const [volumen, setVolumen] = React.useState([60]);
  const [cargando, setCargando] = React.useState(false);
  const [texto, setTexto] = React.useState("");

  return (
    <AppShell
      nav={
        <Sidebar
          rutaActiva={rutas.inicio}
          pendientes={7}
          estadoCanales="revisar"
          linkComponent={EnlaceDemo}
          usuario={{ nombre: "Valentina Ruiz", correo: "valentina@acme.co" }}
          creditos={{
            consumidos: 12400,
            total: 50000,
            renovacion: "3 de septiembre",
            onAmpliar: () => toast.info("Aquí abriría la comparación de planes."),
          }}
          className="hidden lg:flex"
        />
      }
      topbar={
        <Topbar
          contexto="Sistema de diseño"
          titulo="Muestrario de componentes"
          acciones={
            <>
              <ThemeToggle />
              <Tooltip content="Notificaciones" shortcut="N">
                <IconButton label="Notificaciones">
                  <Bell size={18} strokeWidth={1.75} aria-hidden />
                </IconButton>
              </Tooltip>
              <Button size="sm">
                <Plus size={18} strokeWidth={1.75} aria-hidden />
                Contratar agente
              </Button>
            </>
          }
        />
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6 pb-24">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tightest text-fg">
            El color dice quién habla
          </h1>
          <p className="max-w-[64ch] text-md text-fg-secondary">
            Índigo es la inteligencia artificial. Fucsia es la persona que toma el control.
            El neutro elevado es el cliente y el neutro medio es el sistema. Esa regla se
            propaga a botones, banderas, gráficos y a la mascota.
          </p>
        </header>

        <Seccion titulo="Botones">
          <div className="flex flex-col gap-5">
            <Fila>
              <Button variant="primary">Guardar cambios</Button>
              <Button variant="secondary">Cancelar</Button>
              <Button variant="ghost">Descartar</Button>
              <Button variant="human">
                <UserRoundCog size={18} strokeWidth={1.75} aria-hidden />
                Tomar el control
              </Button>
              <Button variant="danger">
                <Trash2 size={18} strokeWidth={1.75} aria-hidden />
                Eliminar agente
              </Button>
              <Button variant="link">Ver la documentación</Button>
            </Fila>
            <Fila>
              <Button size="sm">Pequeño</Button>
              <Button size="md">Mediano</Button>
              <Button size="lg">Grande</Button>
            </Fila>
            <Fila>
              <Button disabled>Deshabilitado</Button>
              <Button variant="human" disabled>
                Deshabilitado
              </Button>
              <Button loading={cargando} onClick={() => {
                setCargando(true);
                window.setTimeout(() => setCargando(false), 1600);
              }}>
                Publicar el agente
              </Button>
              <span className="text-sm text-fg-muted">
                El ancho no cambia al cargar.
              </span>
            </Fila>
            <Fila>
              <IconButton label="Buscar">
                <Search size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Buscar" variant="secondary">
                <Search size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Nuevo" variant="primary">
                <Plus size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Responder yo" variant="human">
                <MessageSquare size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Eliminar" variant="danger">
                <Trash2 size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Cargando" loading />
              <IconButton label="Deshabilitado" disabled>
                <Search size={18} strokeWidth={1.75} aria-hidden />
              </IconButton>
              <Spinner label="Cargando" />
            </Fila>
          </div>
        </Seccion>

        <Seccion titulo="Campos de formulario">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Nombre del agente" help="Así lo verás en la lista de agentes.">
              {(props) => <Input placeholder="Asistente de ventas" {...props} />}
            </Field>
            <Field label="Número de WhatsApp" error="Este número ya está conectado a otro agente.">
              {(props) => <Input defaultValue="+57 300 000 0000" {...props} />}
            </Field>
            <Field label="Buscar contacto" optional>
              {(props) => (
                <Input
                  placeholder="Nombre o teléfono"
                  leadingIcon={<Search aria-hidden />}
                  trailingSlot={<Kbd>/</Kbd>}
                  {...props}
                />
              )}
            </Field>
            <Field label="Campo deshabilitado" help="La opacidad baja; el color no cambia.">
              {(props) => <Input defaultValue="No editable" disabled {...props} />}
            </Field>
            <Field
              label="Instrucciones para el agente"
              help="El área crece con el texto hasta diez líneas."
              className="md:col-span-2"
            >
              {(props) => (
                <Textarea
                  value={texto}
                  onChange={(event) => setTexto(event.target.value)}
                  placeholder="Responde siempre en español, con un tono cercano…"
                  {...props}
                />
              )}
            </Field>
            <Field label="Canal">
              {(props) => (
                <Select defaultValue="whatsapp">
                  <SelectTrigger id={props.id} aria-describedby={props["aria-describedby"]}>
                    <SelectValue placeholder="Elige un canal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="web">Chat web</SelectItem>
                    <SelectItem value="instagram" disabled>
                      Instagram (próximamente)
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <div className="flex flex-col justify-end gap-2">
              <span className="text-base font-medium text-fg">Temperatura de respuesta</span>
              <Slider
                value={volumen}
                onValueChange={setVolumen}
                max={100}
                step={5}
                aria-label="Temperatura de respuesta"
              />
            </div>
          </div>

          <Separator className="my-5" />

          <div className="grid gap-5 md:grid-cols-3">
            <div className="flex flex-col gap-3">
              <CheckboxField
                defaultChecked
                label="Avisarme por correo"
                description="Cuando un cliente pida hablar con una persona."
              />
              <CheckboxField checked="indeterminate" label="Selección parcial" />
              <CheckboxField disabled label="Deshabilitado" />
            </div>
            <RadioGroup defaultValue="inmediato">
              <RadioField value="inmediato" label="Responder de inmediato" />
              <RadioField
                value="retardo"
                label="Esperar unos segundos"
                description="Se siente más humano en conversaciones cortas."
              />
              <RadioField value="nunca" label="No responder solo" disabled />
            </RadioGroup>
            <div className="flex flex-col gap-4">
              <ToggleField
                defaultChecked
                label="Agente activo"
                description="Atiende mensajes nuevos."
              />
              <ToggleField
                tone="human"
                label="Control humano"
                description="Las respuestas las escribes tú."
              />
              <ToggleField label="Deshabilitado" disabled />
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Señales y etiquetas">
          <div className="flex flex-col gap-4">
            <Fila>
              <Badge tone="ia">Respondió la IA</Badge>
              <Badge tone="humano">Control humano</Badge>
              <Badge tone="neutral">Cliente</Badge>
              <Badge tone="exito">Resuelta</Badge>
              <Badge tone="aviso">Sin respuesta</Badge>
              <Badge tone="error">Fallo de envío</Badge>
              <Badge tone="info">Programada</Badge>
              <Badge tone="ia" variant="outline">
                Contorno
              </Badge>
            </Fila>
            <Fila>
              <Tag>ventas</Tag>
              <Tag onRemove={() => toast("Etiqueta quitada")}>bogotá</Tag>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </Fila>
            <Fila>
              <Avatar name="Strappy IA" tone="ia" />
              <Avatar name="Valentina Ruiz" tone="humano" status="en-linea" />
              <Avatar name="Cliente Nuevo" tone="cliente" status="ausente" />
              <Avatar name="Sistema" tone="sistema" size="lg" status="desconectado" />
              <Avatar name="Pequeño" size="sm" />
            </Fila>
            <Fila>
              <FilterChip active={filtroActivo} onClick={() => setFiltroActivo((v) => !v)} count={12}>
                Sin atender
              </FilterChip>
              <FilterChip hasMenu>Canal</FilterChip>
              <FilterChip disabled>Deshabilitado</FilterChip>
            </Fila>
            <div className="flex flex-col gap-2">
              <Skeleton shape="linea" className="w-48" />
              <Skeleton shape="linea" className="w-72" />
              <div className="flex items-center gap-3">
                <Skeleton shape="circulo" />
                <Skeleton className="h-10 w-64" />
              </div>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Navegación y agrupación">
          <div className="flex flex-col gap-6">
            <SegmentedControl
              label="Filtrar por quién responde"
              value={segmento}
              onValueChange={setSegmento}
              options={[
                { value: "todas", label: "Todas" },
                { value: "ia", label: "La IA" },
                { value: "humano", label: "Un humano" },
              ]}
            />

            <Tabs defaultValue="conversaciones">
              <TabsList>
                <TabsTrigger value="conversaciones" count={7}>
                  Conversaciones
                </TabsTrigger>
                <TabsTrigger value="agentes">Agentes</TabsTrigger>
                <TabsTrigger value="registros">Registros</TabsTrigger>
                <TabsTrigger value="bloqueada" disabled>
                  Sin permiso
                </TabsTrigger>
              </TabsList>
              <TabsContent value="conversaciones" className="pt-4 text-base text-fg-secondary">
                El subrayado se desliza hasta la pestaña activa en 200 ms.
              </TabsContent>
              <TabsContent value="agentes" className="pt-4 text-base text-fg-secondary">
                Tres agentes activos.
              </TabsContent>
              <TabsContent value="registros" className="pt-4 text-base text-fg-secondary">
                Sin registros en las últimas 24 horas.
              </TabsContent>
            </Tabs>

            <Accordion type="single" collapsible className="rounded-lg border border-border px-4">
              <AccordionItem value="uno">
                <AccordionTrigger>¿Qué pasa si el agente no sabe responder?</AccordionTrigger>
                <AccordionContent>
                  Marca la conversación como pendiente y te avisa en la bandeja.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="dos">
                <AccordionTrigger>¿Puedo escribir yo en medio de una conversación?</AccordionTrigger>
                <AccordionContent>
                  Sí. Al tomar el control, el agente deja de responder hasta que lo devuelvas.
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Stepper
              current={1}
              steps={[
                { id: "canal", label: "Conectar canal", description: "WhatsApp" },
                { id: "personalidad", label: "Definir el agente", description: "Tono y límites" },
                { id: "prueba", label: "Probar", description: "Antes de publicar" },
              ]}
            />

            <Pagination page={pagina} pageCount={12} onPageChange={setPagina} />
          </div>
        </Seccion>

        <Seccion titulo="Superficies">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Asistente de ventas</CardTitle>
                <CardDescription>Atiende WhatsApp desde el 4 de agosto.</CardDescription>
              </CardHeader>
              <CardBody>
                <div className="flex items-center gap-2">
                  <Badge tone="exito">Activo</Badge>
                  <Badge tone="ia">312 respuestas</Badge>
                </div>
              </CardBody>
              <CardFooter>
                <Button variant="secondary" size="sm">
                  Editar
                </Button>
                <Button variant="ghost" size="sm">
                  Ver conversaciones
                </Button>
              </CardFooter>
            </Card>

            <Panel
              title="Créditos del plan"
              description="Se renuevan cada mes"
              actions={
                <Button variant="ghost" size="sm">
                  Historial
                </Button>
              }
            >
              <div className="grid gap-3">
                <CreditsWidget consumidos={12400} total={50000} renovacion="3 de septiembre" onAmpliar={() => {}} />
                <CreditsWidget consumidos={46200} total={50000} renovacion="3 de septiembre" onAmpliar={() => {}} />
              </div>
            </Panel>
          </div>
        </Seccion>

        <Seccion titulo="Capas y avisos">
          <Fila>
            <Modal>
              <ModalTrigger asChild>
                <Button variant="secondary">Abrir modal</Button>
              </ModalTrigger>
              <ModalContent
                title="¿Eliminar el agente?"
                description="Sus conversaciones se conservan, pero dejará de responder de inmediato."
                footer={
                  <>
                    <ModalClose asChild>
                      <Button variant="ghost">Cancelar</Button>
                    </ModalClose>
                    <ModalClose asChild>
                      <Button variant="danger">Eliminar</Button>
                    </ModalClose>
                  </>
                }
              />
            </Modal>

            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="secondary">Abrir panel lateral</Button>
              </DrawerTrigger>
              <DrawerContent title="Detalle del contacto" description="Camila Restrepo">
                <div className="flex flex-col gap-3 text-base text-fg-secondary">
                  <p>Último mensaje hace 4 minutos.</p>
                  <Badge tone="humano">Atendida por Valentina</Badge>
                </div>
              </DrawerContent>
            </Drawer>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Abrir popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="text-base text-fg-secondary">
                  Los popovers llevan contenido corto y una sola acción.
                </p>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">Abrir menú</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Conversación</DropdownMenuLabel>
                <DropdownMenuItem shortcut="⌘E">
                  <MessageSquare aria-hidden />
                  Responder yo
                </DropdownMenuItem>
                <DropdownMenuItem shortcut="⌘R">
                  <Sparkles aria-hidden />
                  Devolver a la IA
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem tone="danger">
                  <Trash2 aria-hidden />
                  Archivar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" onClick={() => toast.success("Agente publicado")}>
              Aviso de éxito
            </Button>
            <Button variant="ghost" onClick={() => toast.error("No se pudo enviar el mensaje")}>
              Aviso de error
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                toast.warning("Te queda el 8 % de créditos", {
                  description: "Se renuevan el 3 de septiembre.",
                })
              }
            >
              Aviso de advertencia
            </Button>
          </Fila>
        </Seccion>

        <Seccion titulo="Estados vacíos">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border">
              <EmptyState
                variant="primera-vez"
                size="sm"
                title="Aún no tienes agentes"
                description="Cuéntale a Strappy qué necesitas y él arma el primero por ti."
                action={<Button>Contratar agente</Button>}
              />
            </div>
            <div className="rounded-lg border border-border">
              <EmptyState
                variant="sin-resultados"
                size="sm"
                title="Sin resultados"
                description="No hay conversaciones que coincidan con estos filtros."
                action={<Button variant="secondary">Quitar filtros</Button>}
              />
            </div>
            <div className="rounded-lg border border-border">
              <EmptyState
                variant="error"
                size="sm"
                title="No pudimos cargar la bandeja"
                description="La conexión falló. Vuelve a intentarlo en unos segundos."
                action={<Button variant="secondary">Reintentar</Button>}
              />
            </div>
            <div className="rounded-lg border border-border">
              <EmptyState
                variant="sin-permiso"
                size="sm"
                title="No tienes acceso a esta sección"
                description="Pídele a quien administra la cuenta que te dé permiso."
                action={<Button variant="secondary">Solicitar acceso</Button>}
              />
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Strap, la mascota">
          <div className="flex flex-wrap gap-6">
            {strapPoses.map((pose) => (
              <figure key={pose} className="flex w-28 flex-col items-center gap-2">
                <Strap pose={pose} size={96} breathe={pose === "esperando"} title={strapAlt(pose)} />
                <figcaption className="text-sm text-fg-muted">{pose}</figcaption>
              </figure>
            ))}
          </div>
        </Seccion>
      </div>
    </AppShell>
  );
}
