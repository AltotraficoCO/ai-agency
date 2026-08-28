/**
 * Tipos de entrada del compilador de prompt.
 *
 * Todo lo que entra aquí es dato plano y serializable: el compilador es una
 * función pura y el hash que produce se guarda junto a cada ejecución. Si
 * algún campo dejara de ser serializable, el hash dejaría de ser reproducible.
 */

/** Un dato que el agente debe averiguar durante la conversación. */
export type CollectField = {
  readonly key: string;
  /** Cómo se llama el dato para una persona, p.ej. "ciudad de entrega". */
  readonly label: string;
  /** Pista de cómo preguntarlo sin sonar a formulario. Opcional. */
  readonly hint?: string;
  readonly required?: boolean;
};

/**
 * Lo que el agente necesita saber de una herramienta: cuándo usarla y si
 * pide aprobación. Deliberadamente NO es el `ToolDef` de `@strappy/tools`:
 * el compilador de prompt no ejecuta nada, solo describe.
 */
export type ToolContract = {
  readonly slug: string;
  readonly label: string;
  /** Frase en imperativo: "cuando el cliente pregunte por precios o catálogo". */
  readonly whenToUse: string;
  readonly requiresApproval?: boolean;
};

export type CompanyContext = {
  readonly name: string;
  readonly description?: string;
  readonly industry?: string;
  readonly website?: string;
  /** Horario de atención tal cual lo escribió la empresa. */
  readonly hours?: string;
  /** Políticas que el agente no puede contradecir (devoluciones, envíos…). */
  readonly policies?: readonly string[];
};

export type AgentIdentity = {
  readonly name: string;
  /** Etiqueta BCP-47 o nombre del idioma. Se copia tal cual al prompt. */
  readonly language: string;
  /** Tono en palabras de la empresa: "cercano y breve, tutea". */
  readonly tone: string;
  /** Para qué existe este agente en una frase. */
  readonly purpose: string;
};

export type PromptSpec = {
  readonly agent: AgentIdentity;
  readonly company?: CompanyContext;
  /** Instrucciones del usuario en Markdown. Puede usar {{variables}}. */
  readonly instructions: string;
  /** Valores constantes para resolver {{variables}} en las instrucciones. */
  readonly variables?: Readonly<Record<string, string>>;
  readonly tools?: readonly ToolContract[];
  /** Objetivo de negocio del agente: "agendar una demo". */
  readonly goal?: string;
  readonly collect?: readonly CollectField[];
  /**
   * Nombre visible del canal, solo para que el agente sepa dónde escribe.
   * Es una etiqueta, no una capacidad: el núcleo sigue sin conocer canales.
   */
  readonly channelLabel?: string;
};

/** Un fragmento recuperado del conocimiento de la empresa. */
export type KnowledgeSnippet = {
  readonly title: string;
  readonly text: string;
  readonly source?: string;
};

/** Todo lo que cambia entre un turno y el siguiente. Va detrás del corte de caché. */
export type DynamicContext = {
  readonly now: Date;
  /** Zona IANA, p.ej. "America/Bogota". */
  readonly timezone: string;
  readonly contact?: {
    readonly name?: string;
    readonly externalId?: string;
    readonly notes?: string;
  };
  /** Datos ya averiguados. Se ordenan por clave para que el bloque sea estable. */
  readonly collected?: Readonly<Record<string, string | number | boolean | null>>;
  readonly knowledge?: readonly KnowledgeSnippet[];
  /** Resumen rodante de la conversación, si ya se generó. */
  readonly summary?: string;
};

export type CompiledPrompt = {
  /** Capas 1 a 6: estable, cacheable, idéntico mientras no cambie el spec. */
  readonly system: string;
  /** Índice del corte de caché dentro de `system + dynamic`. */
  readonly cacheBreakpoint: number;
  /** Capa 7: volátil. Va como bloque aparte para no invalidar el caché. */
  readonly dynamic: string;
  /** sha256 de la parte estable. Es la clave de caché y la huella de la versión. */
  readonly hash: string;
};
