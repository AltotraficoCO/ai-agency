"use client";

/**
 * Crear una base de conocimiento.
 *
 * Solo pide lo imprescindible —un nombre— y lleva directo a la base recién
 * creada, que es donde de verdad se hace el trabajo: darle qué aprender.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Field, Input, Modal, ModalContent, Textarea, toast } from "@strappy/ui";
import { accionCrearCerebro } from "@/lib/conocimiento/acciones";

export function NuevaBase({ grande = false }: { grande?: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = React.useState(false);
  const [nombre, setNombre] = React.useState("");
  const [descripcion, setDescripcion] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [creando, setCreando] = React.useState(false);

  const crear = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const limpio = nombre.trim();
    if (limpio.length < 2) {
      setError("Ponle un nombre que la identifique, por ejemplo «Catálogo y precios».");
      return;
    }
    setCreando(true);
    setError(null);
    const resultado = await accionCrearCerebro({
      nombre: limpio,
      ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}),
    }).catch(() => ({ ok: false as const, error: "No pudimos crearla. Vuelve a intentarlo." }));
    setCreando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    toast.success("Base creada. Ahora dale algo que aprender.");
    setAbierto(false);
    router.push(`/conocimiento/${resultado.datos.id}`);
  };

  return (
    <Modal
      open={abierto}
      onOpenChange={(valor) => {
        setAbierto(valor);
        if (!valor) setError(null);
      }}
    >
      <Button size={grande ? "lg" : "md"} onClick={() => setAbierto(true)}>
        <Plus size={16} aria-hidden />
        Nueva base de conocimiento
      </Button>
      <ModalContent
        title="Nueva base de conocimiento"
        description="Agrupa lo que tus agentes deben saber sobre un tema. Luego le das tu web, archivos o datos."
      >
        <form id="form-nueva-base" onSubmit={crear} className="flex flex-col gap-4 pb-4">
          <Field label="Nombre" error={error ?? undefined}>
            {(props) => (
              <Input
                {...props}
                autoFocus
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Catálogo y precios"
                maxLength={60}
              />
            )}
          </Field>
          <Field label="Descripción" optional help="Para qué sirve, en una frase. Solo la ves tú.">
            {(props) => (
              <Textarea
                {...props}
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Productos, precios y promociones vigentes"
                rows={2}
                maxLength={240}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={creando} loadingLabel="Creando">
              Crear y añadir conocimiento
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
