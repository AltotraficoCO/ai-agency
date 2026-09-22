export const metadata = {
  title: "Política de privacidad",
  description: "Qué datos trata Strappy, para qué, con quién y qué derechos tienes.",
};

const ACTUALIZADA = "22 de septiembre de 2026";

export default function Pagina() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p className="text-fg-muted">Última actualización: {ACTUALIZADA}</p>

      <p>
        Strappy es una plataforma con la que una empresa contrata agentes de inteligencia artificial
        que trabajan sobre sus propias herramientas: su WhatsApp, su sitio web, su contabilidad y sus
        cuentas de anuncios. Para hacerlo necesita acceder a datos. Esta política explica cuáles,
        para qué, con quién se comparten y cómo puedes controlarlos.
      </p>

      <h2>1. Quién trata los datos</h2>
      <p>
        El responsable del tratamiento es Strappy, accesible en{" "}
        <a href="https://strappy.io">strappy.io</a>. Para cualquier asunto sobre tus datos escribe a{" "}
        <a href="mailto:hola@strappy.io">hola@strappy.io</a>.
      </p>

      <h2>2. Qué datos tratamos</h2>
      <p>Distinguimos tres grupos.</p>
      <h3>Datos de tu cuenta</h3>
      <p>
        Nombre, correo electrónico, contraseña cifrada, nombre de tu empresa, datos de facturación
        y el historial de créditos consumidos. Los pagos los procesa Stripe; Strappy no guarda el
        número de tu tarjeta.
      </p>
      <h3>Datos de las herramientas que conectas</h3>
      <p>
        Cuando conectas una herramienta, Strappy guarda la credencial que esa herramienta le entrega
        (un token de acceso) y accede solo a lo que el agente contratado necesita:
      </p>
      <ul>
        <li>
          <strong>WhatsApp Business:</strong> los mensajes que tus clientes envían a tu número y las
          respuestas que da el agente, para poder mantener la conversación.
        </li>
        <li>
          <strong>Sitio web (WordPress):</strong> páginas, entradas, imágenes y ajustes de diseño,
          para crearlos o modificarlos cuando lo pides.
        </li>
        <li>
          <strong>Google Ads, Meta Ads y TikTok Ads:</strong> tus cuentas publicitarias, campañas,
          presupuestos, gasto y resultados, para analizarlos y, con tu aprobación, ajustarlos.
        </li>
        <li>
          <strong>Contabilidad (Alegra):</strong> facturas, pagos, cartera y contactos, para
          preparar informes y recordatorios de cobro.
        </li>
        <li>
          <strong>Rendimiento web (PageSpeed):</strong> mediciones públicas de la velocidad de tu
          sitio.
        </li>
      </ul>
      <h3>Datos de las personas que hablan con tus agentes</h3>
      <p>
        Cuando un agente atiende a un cliente tuyo por WhatsApp, Strappy guarda el número, el nombre
        que aparece en el perfil y la conversación. En ese caso tú eres el responsable de esos datos
        y Strappy los trata por encargo tuyo.
      </p>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Para que los agentes hagan el trabajo que les encargas.</li>
        <li>Para mostrarte qué hizo cada agente, cuánto costó y pedirte aprobación cuando toca.</li>
        <li>Para cobrar los créditos consumidos y emitir tus facturas.</li>
        <li>Para avisarte, por correo o WhatsApp, de lo que pasa en tu cuenta.</li>
        <li>Para mantener el servicio seguro y detectar usos abusivos.</li>
      </ul>
      <p>
        <strong>No vendemos tus datos</strong>, no los usamos para publicidad de terceros y no
        entrenamos modelos de inteligencia artificial con ellos.
      </p>

      <h2>4. Con quién los compartimos</h2>
      <p>Solo con los proveedores que hacen falta para prestar el servicio:</p>
      <ul>
        <li>
          <strong>Proveedores de modelos de IA</strong> (a través de OpenRouter): reciben el texto
          necesario para que el agente razone y responda. Se usan bajo acuerdos que prohíben
          entrenar con esos datos.
        </li>
        <li>
          <strong>Supabase</strong>: la base de datos donde vive tu cuenta.
        </li>
        <li>
          <strong>Vercel</strong>: donde se ejecuta la aplicación.
        </li>
        <li>
          <strong>Stripe</strong>: el cobro.
        </li>
        <li>
          <strong>Meta, Google, TikTok, Alegra y WordPress</strong>: las plataformas que tú mismo
          conectas, en los términos de cada una.
        </li>
      </ul>
      <p>
        Fuera de esos casos, solo entregamos datos si una autoridad lo exige por ley.
      </p>

      <h2>5. Datos de servicios de Google</h2>
      <p>
        El uso que Strappy hace de la información recibida de las API de Google se ajusta a la{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Política de datos de usuario de los servicios de API de Google
        </a>
        , incluidos los requisitos de uso limitado. En concreto: los datos de Google Ads se usan
        únicamente para analizar y gestionar tus campañas dentro de Strappy, no se transfieren a
        terceros salvo para prestar esa función o por exigencia legal, y ninguna persona los lee
        salvo que tú lo autorices, sea necesario por seguridad o lo exija la ley.
      </p>

      <h2>6. Cómo los protegemos</h2>
      <p>
        Las credenciales de las herramientas que conectas se guardan cifradas y solo el sistema que
        ejecuta los agentes puede descifrarlas. Todo el tráfico va por HTTPS. Cada empresa ve
        únicamente sus propios datos. Los cambios importantes que un agente propone (publicar,
        mover presupuesto, emitir una factura) requieren tu aprobación explícita.
      </p>

      <h2>7. Cuánto tiempo los guardamos</h2>
      <p>
        Mientras tu cuenta esté activa. Si desconectas una herramienta, su credencial se borra en el
        momento. Si cierras la cuenta, borramos tus datos en un plazo de 30 días, salvo los que la
        ley contable nos obligue a conservar.
      </p>

      <h2>8. Tus derechos</h2>
      <p>
        Puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar en cualquier momento
        la autorización que nos diste, conforme a la Ley 1581 de 2012 de Colombia y a la normativa
        que te sea aplicable. Puedes hacerlo desde los ajustes de tu cuenta o escribiendo a{" "}
        <a href="mailto:hola@strappy.io">hola@strappy.io</a>. Respondemos en un máximo de 15 días
        hábiles.
      </p>
      <p>
        El acceso que concedes a Google, Meta o TikTok puedes retirarlo también desde tu cuenta en
        cada una de esas plataformas.
      </p>

      <h2>9. Cambios en esta política</h2>
      <p>
        Si cambiamos algo relevante te lo avisaremos por correo antes de que entre en vigor. La
        fecha de arriba indica la versión vigente.
      </p>
    </>
  );
}
