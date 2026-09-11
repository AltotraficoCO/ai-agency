"use client";

/**
 * Los cuatro formularios de acceso.
 *
 * Están juntos porque comparten forma, mensajes y manejo de error, y tenerlos
 * separados en cuatro archivos casi iguales es como se acaba con cuatro
 * traducciones distintas del mismo error.
 *
 * Los mensajes de Supabase llegan en inglés; se traducen aquí. Un error en
 * inglés en una interfaz en español no es un detalle: es la señal de que a
 * nadie le importó lo suficiente.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle, Field, Input } from "@strappy/ui";
import { crearClienteNavegador } from "@/lib/supabase/navegador";
import { BotonGoogle } from "./boton-google";

const TRADUCCIONES: readonly (readonly [RegExp, string])[] = [
  [/invalid login credentials/i, "El correo o la contraseña no son correctos."],
  [/email not confirmed/i, "Todavía no has confirmado tu correo. Revisa tu bandeja de entrada."],
  [/user already registered/i, "Ya existe una cuenta con ese correo. Inicia sesión."],
  [/password should be at least (\d+)/i, "La contraseña debe tener al menos $1 caracteres."],
  [/rate limit|too many requests/i, "Demasiados intentos. Espera un minuto y vuelve a probar."],
  [/unable to validate email/i, "Ese correo no parece válido."],
  [/for security purposes/i, "Espera unos segundos antes de volver a intentarlo."],
];

function traducir(mensaje: string): string {
  for (const [patron, texto] of TRADUCCIONES) {
    const m = patron.exec(mensaje);
    if (m) return texto.replace("$1", m[1] ?? "");
  }
  return mensaje;
}

function Marco({
  titulo,
  descripcion,
  children,
  pie,
}: {
  titulo: string;
  descripcion: string;
  children: React.ReactNode;
  pie?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <p className="text-sm text-fg-secondary">{descripcion}</p>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {children}
        {pie && <div className="text-sm text-fg-secondary">{pie}</div>}
      </CardBody>
    </Card>
  );
}

function Separador() {
  return (
    <div className="flex items-center gap-3">
      <hr className="flex-1 border-0 border-t border-[var(--border-subtle)]" />
      <span className="text-2xs text-fg-muted">o con tu correo</span>
      <hr className="flex-1 border-0 border-t border-[var(--border-subtle)]" />
    </div>
  );
}

export function FormularioEntrar() {
  const router = useRouter();
  const [correo, setCorreo] = React.useState("");
  const [clave, setClave] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [cargando, setCargando] = React.useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    const { error: fallo } = await supabase.auth.signInWithPassword({
      email: correo,
      password: clave,
    });
    if (fallo) {
      setError(traducir(fallo.message));
      setCargando(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Marco
      titulo="Entra a Strappy"
      descripcion="Tus agentes te están esperando."
      pie={
        <>
          ¿Todavía no tienes cuenta? <Link className="text-primary-fg underline" href="/registro">Crea una</Link>.
        </>
      }
    >
      <BotonGoogle />
      <Separador />
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <Field label="Correo electrónico">
          {(campo) => (
            <Input {...campo}
            type="email"
            autoComplete="email"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
          )}
        </Field>
        <Field label="Contraseña">
          {(campo) => (
            <Input {...campo}
            type="password"
            autoComplete="current-password"
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          )}
        </Field>
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        <Button type="submit" loading={cargando} className="w-full">
          Entrar
        </Button>
        <Link className="text-sm text-fg-secondary underline" href="/recuperar">
          Se me olvidó la contraseña
        </Link>
      </form>
    </Marco>
  );
}

export function FormularioRegistro() {
  const router = useRouter();
  const [empresa, setEmpresa] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [correo, setCorreo] = React.useState("");
  const [clave, setClave] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [cargando, setCargando] = React.useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    // `organization` y `full_name` los lee el disparador `handle_new_user`, que
    // crea la organización, el espacio, la membresía de propietario y la cartera
    // de créditos. Sin ellos el espacio se llamaría como la parte izquierda del
    // correo, que es un nombre que nadie reconoce como suyo.
    const { data, error: fallo } = await supabase.auth.signUp({
      email: correo,
      password: clave,
      options: {
        data: { full_name: nombre, organization: empresa },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (fallo) {
      setError(traducir(fallo.message));
      setCargando(false);
      return;
    }
    if (!data.session) {
      setAviso(`Te enviamos un correo a ${correo}. Ábrelo para confirmar tu cuenta.`);
      setCargando(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Marco
      titulo="Crea tu cuenta"
      descripcion="En un minuto tienes tu primer agente probándose."
      pie={
        <>
          ¿Ya tienes cuenta? <Link className="text-primary-fg underline" href="/entrar">Entra</Link>.
        </>
      }
    >
      <BotonGoogle />
      <Separador />
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <Field label="Nombre de tu empresa">
          {(campo) => (
            <Input {...campo} required value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Panadería La Espiga" />
          )}
        </Field>
        <Field label="Tu nombre">
          {(campo) => (
            <Input {...campo} required autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          )}
        </Field>
        <Field label="Correo electrónico">
          {(campo) => (
            <Input {...campo} type="email" autoComplete="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
          )}
        </Field>
        <Field label="Contraseña" help="Al menos ocho caracteres.">
          {(campo) => (
            <Input {...campo}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          )}
        </Field>
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        {aviso && <p className="text-sm text-success-fg">{aviso}</p>}
        <Button type="submit" loading={cargando} className="w-full">
          Crear cuenta
        </Button>
      </form>
    </Marco>
  );
}

export function FormularioRecuperar() {
  const [correo, setCorreo] = React.useState("");
  const [enviado, setEnviado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cargando, setCargando] = React.useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    const { error: fallo } = await supabase.auth.resetPasswordForEmail(correo, {
      redirectTo: `${window.location.origin}/auth/callback?siguiente=/actualizar-clave`,
    });
    setCargando(false);
    // Se responde igual exista o no la cuenta: decir «ese correo no existe» es
    // regalarle a cualquiera la lista de quién tiene cuenta aquí.
    if (fallo && !/rate limit|too many/i.test(fallo.message)) setError(traducir(fallo.message));
    else setEnviado(true);
  }

  if (enviado) {
    return (
      <Marco
        titulo="Revisa tu correo"
        descripcion={`Si hay una cuenta con ${correo}, te acabamos de mandar un enlace para poner una contraseña nueva.`}
        pie={<Link className="text-primary-fg underline" href="/entrar">Volver a entrar</Link>}
      >
        <span />
      </Marco>
    );
  }

  return (
    <Marco
      titulo="Recupera tu contraseña"
      descripcion="Te mandamos un enlace para ponerte una nueva."
      pie={<Link className="text-primary-fg underline" href="/entrar">Volver a entrar</Link>}
    >
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <Field label="Correo electrónico">
          {(campo) => (
            <Input {...campo} type="email" autoComplete="email" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
          )}
        </Field>
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        <Button type="submit" loading={cargando} className="w-full">
          Enviarme el enlace
        </Button>
      </form>
    </Marco>
  );
}

export function FormularioActualizarClave() {
  const router = useRouter();
  const [clave, setClave] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [cargando, setCargando] = React.useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    const { error: fallo } = await supabase.auth.updateUser({ password: clave });
    if (fallo) {
      setError(traducir(fallo.message));
      setCargando(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Marco titulo="Pon una contraseña nueva" descripcion="La anterior deja de funcionar en cuanto guardes esta.">
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <Field label="Contraseña nueva" help="Al menos ocho caracteres.">
          {(campo) => (
            <Input {...campo}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          )}
        </Field>
        {error && <p className="text-sm text-danger-fg">{error}</p>}
        <Button type="submit" loading={cargando} className="w-full">
          Guardar
        </Button>
      </form>
    </Marco>
  );
}
