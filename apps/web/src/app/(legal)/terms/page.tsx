export const metadata = {
  title: "Términos del servicio",
  description: "Las condiciones para usar Strappy y contratar sus agentes.",
};

const ACTUALIZADOS = "22 de septiembre de 2026";

export default function Pagina() {
  return (
    <>
      <h1>Términos del servicio</h1>
      <p className="text-fg-muted">Última actualización: {ACTUALIZADOS}</p>

      <p>
        Estos términos regulan el uso de Strappy, la plataforma disponible en{" "}
        <a href="https://strappy.io">strappy.io</a>. Al crear una cuenta los aceptas. Si los usas en
        nombre de una empresa, declaras que puedes obligarla.
      </p>

      <h2>1. Qué es Strappy</h2>
      <p>
        Strappy te permite contratar agentes de inteligencia artificial que realizan trabajo sobre
        las herramientas que tú conectas: atención por WhatsApp, gestión de tu sitio web, análisis y
        ajuste de campañas publicitarias, contabilidad e informes. Cada agente hace lo que su ficha
        describe, con las instrucciones que tú le das.
      </p>

      <h2>2. Tu cuenta</h2>
      <p>
        Eres responsable de mantener tu contraseña en secreto y de todo lo que se haga desde tu
        cuenta. Debes darnos datos veraces y avisarnos si detectas un acceso no autorizado.
      </p>

      <h2>3. Las herramientas que conectas</h2>
      <p>
        Al conectar WhatsApp, WordPress, Google Ads, Meta Ads, TikTok Ads, Alegra u otra
        herramienta, nos autorizas a acceder a ella en tu nombre, solo para lo que el agente
        contratado necesita. Debes tener derecho a conceder ese acceso. Cada plataforma tiene sus
        propias condiciones, que también te aplican. Puedes desconectar cualquier herramienta
        cuando quieras.
      </p>

      <h2>4. Créditos y pagos</h2>
      <ul>
        <li>
          El trabajo de los agentes se paga con créditos. Cada plan incluye una cantidad mensual y
          puedes recargar más.
        </li>
        <li>
          El coste de cada tarea se muestra antes o inmediatamente después de ejecutarla, y el
          historial de consumo está siempre disponible en tu cuenta.
        </li>
        <li>
          Los créditos no son reembolsables ni canjeables por dinero, salvo que la ley disponga otra
          cosa. Los del plan caducan al terminar el ciclo; los de recarga no caducan mientras la
          cuenta esté activa.
        </li>
        <li>
          Los precios pueden cambiar. Te avisaremos con al menos 30 días de antelación y el cambio
          aplicará en tu siguiente ciclo.
        </li>
        <li>Los pagos los procesa Stripe. Los impuestos aplicables se añaden según tu país.</li>
      </ul>

      <h2>5. Aprobaciones y responsabilidad sobre lo que hacen los agentes</h2>
      <p>
        Los agentes proponen y ejecutan tareas según tus instrucciones. Las acciones con
        consecuencias relevantes (publicar contenido, cambiar presupuestos de anuncios, emitir
        facturas, enviar mensajes masivos) requieren tu aprobación explícita antes de ejecutarse, y
        puedes exigir aprobación para cualquier otra.
      </p>
      <p>
        La inteligencia artificial puede equivocarse. Tú decides qué le encargas, revisas lo que
        propone y respondes ante tus clientes, proveedores y autoridades por el resultado. Strappy
        pone los medios para que revises y apruebes; no sustituye tu criterio profesional, legal ni
        contable.
      </p>

      <h2>6. Usos no permitidos</h2>
      <p>No puedes usar Strappy para:</p>
      <ul>
        <li>Enviar mensajes no solicitados o contrarios a las políticas de WhatsApp.</li>
        <li>Publicar contenido ilegal, engañoso o que infrinja derechos de terceros.</li>
        <li>Acceder a cuentas o herramientas sobre las que no tengas autorización.</li>
        <li>Intentar vulnerar la seguridad del servicio o de otros usuarios.</li>
        <li>Revender el servicio sin acuerdo escrito con nosotros.</li>
      </ul>
      <p>Si detectamos un uso así podemos suspender la cuenta, avisándote salvo que sea urgente.</p>

      <h2>7. Tu contenido y el nuestro</h2>
      <p>
        Todo lo que subes, conectas o generan los agentes para ti es tuyo. Nos das únicamente la
        licencia necesaria para prestarte el servicio. La plataforma, su código, sus marcas y sus
        personajes son de Strappy.
      </p>

      <h2>8. Disponibilidad</h2>
      <p>
        Trabajamos para que Strappy esté disponible de forma continua, pero dependemos de terceros
        (proveedores de modelos, Meta, Google y otros) y puede haber interrupciones. Te avisaremos de
        los mantenimientos programados cuando sea posible.
      </p>

      <h2>9. Limitación de responsabilidad</h2>
      <p>
        En la medida en que la ley lo permita, Strappy no responde por lucro cesante ni por daños
        indirectos derivados del uso del servicio, y su responsabilidad total se limita a lo que
        hayas pagado en los 12 meses anteriores al hecho que la origine.
      </p>

      <h2>10. Cancelación</h2>
      <p>
        Puedes cancelar cuando quieras desde tu cuenta. Al cancelar, los agentes dejan de trabajar
        al final del ciclo pagado y tus datos se tratan como indica la{" "}
        <a href="/policy">política de privacidad</a>. Nosotros podemos dar por terminado el
        servicio con 30 días de aviso, o de inmediato si incumples estos términos.
      </p>

      <h2>11. Ley aplicable</h2>
      <p>
        Estos términos se rigen por las leyes de la República de Colombia. Antes de acudir a los
        tribunales intentaremos resolver cualquier diferencia de buena fe escribiéndonos a{" "}
        <a href="mailto:hola@strappy.io">hola@strappy.io</a>.
      </p>

      <h2>12. Cambios</h2>
      <p>
        Podemos actualizar estos términos. Si el cambio es relevante te lo comunicaremos por correo
        con antelación. Seguir usando Strappy después de la fecha indicada supone aceptarlos.
      </p>
    </>
  );
}
