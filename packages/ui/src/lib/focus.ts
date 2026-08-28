/**
 * Anillo de foco del sistema: 2px con 2px de separación.
 * Se aplica con :focus-visible para que el ratón no lo dispare.
 */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]";

/** Deshabilitado: baja la opacidad, nunca cambia el tono (se perdería la afinidad de color). */
export const disabledStyles =
  "disabled:opacity-45 disabled:pointer-events-none data-[disabled]:opacity-45";
