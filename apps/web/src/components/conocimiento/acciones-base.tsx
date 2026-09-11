"use client";

/**
 * Editar y eliminar una base, en la barra superior.
 *
 * Son acciones secundarias: van discretas arriba y no compiten con «Añadir
 * conocimiento». Eliminar pide confirmación y dice qué se pierde.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Field,
  IconButton,
  Input,
  Modal,
  ModalContent,
  Textarea,
  Tooltip,
  toast,
} from "@strappy/ui";
import { accionEditarCerebro, accionEliminarCerebro } from "@/lib/conocimiento/acciones";

const FALLO = { ok: false as const, error: "No pudimos completar la acción. Vuelve a intentarlo." };

export function AccionesBase({
  id,
  nombre,
  descripcion,
}: {
  id: string;
  nombre: string;
  descripcion: string | null;
}) {
  const router = useRouter();
  const [editando, setEditando] = React.useState(false);
  const [borrando, setBorrando] = React.useState(false);
  const [nuevoNombre, setNuevoNombre] = React.useState(nombre);
  const [nuevaDescripcion, setNuevaDescripcion] = React.useState(descripcion ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [trabajando, setTrabajando] = React.useState(false);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (nuevoNombre.trim().length < 2) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    setTrabajando(true);
    const resultado = await accionEditarCerebro(id, {
      nombre: nuevoNombre.trim(),
      ...(nuevaDescripcion.trim() ? { descripcion: nuevaDescripcion.trim() } : {}),
    }).catch(() => FALLO);
    setTrabajando(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    toast.success("Cambios guardados");
    setEditando(false);
    router.refresh();
  };

  const eliminar = async () => {
    setTrabajando(true);
    const resultado = await accionEliminarCerebro(id).catch(() => FALLO);
    setTrabajando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success(`«${nombre}» eliminada`);
    setBorrando(false);
    router.push("/conocimiento");
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setNuevoNombre(nombre);
          setNuevaDescripcion(descripcion ?? "");
          setError(null);
          setEditando(true);
        }}
      >
        <Pencil size={14} aria-hidden />
        <span className="hidden sm:inline">Editar</span>
      </Button>
      <Tooltip content="Eliminar base">
        <IconButton label="Eliminar base" size="sm" variant="danger" onClick={() => setBorrando(true)}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>

      <Modal open={editando} onOpenChange={setEditando}>
        <ModalContent title="Editar base de conocimiento">
          <form onSubmit={guardar} className="flex flex-col gap-4 pb-4">
            <Field label="Nombre" error={error ?? undefined}>
              {(props) => (
                <Input {...props} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} maxLength={60} />
              )}
            </Field>
            <Field label="Descripción" optional>
              {(props) => (
                <Textarea
                  {...props}
                  value={nuevaDescripcion}
                  onChange={(e) => setNuevaDescripcion(e.target.value)}
                  rows={2}
                  maxLength={240}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={trabajando} loadingLabel="Guardando">
                Guardar
              </Button>
            </div>
          </form>
        </ModalContent>
      </Modal>

      <Modal open={borrando} onOpenChange={setBorrando}>
        <ModalContent
          title={`¿Eliminar «${nombre}»?`}
          description="Se borran sus fuentes y todo lo que aprendió. Los agentes conectados dejarán de usar esta información. No se puede deshacer."
          footer={
            <>
              <Button variant="ghost" onClick={() => setBorrando(false)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={trabajando} loadingLabel="Eliminando" onClick={() => void eliminar()}>
                Eliminar base
              </Button>
            </>
          }
        />
      </Modal>
    </>
  );
}
