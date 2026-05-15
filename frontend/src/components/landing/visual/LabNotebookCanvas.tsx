import { ReactNode } from 'react';

/**
 * LabNotebookCanvas — the parent wrapper that paints the lab-notebook
 * ruled-paper background.
 *
 * The actual paint is done by the `.lab-notebook-canvas` class defined
 * in `index.css`, which composes:
 *   1. A `linear-gradient` for the vertical red margin line
 *   2. A `repeating-linear-gradient` for the horizontal blue ruling
 *   3. The base `r1-bg` background color
 *
 * Per Cursor rule 26 I-5: this component is a thin wrapper. It does
 * not render its own SVG, image, or canvas — all the visual work is
 * in CSS. The wrapper exists so React composition reads naturally
 * (`<LabNotebookCanvas>...</LabNotebookCanvas>`) rather than requiring
 * every consumer to remember a magic className.
 *
 * Per Cursor rule 26 I-9 (WO-W composition): the animated beams from
 * WO-W mount as a child of this component. They use `mix-blend-screen`
 * to interact with the ruling, illuminating grid lines as beams pass
 * over them.
 *
 * Use:
 *   <LabNotebookCanvas>
 *     <Hero />          // or <PersonaAwareHero />
 *     <AnimatedBeams /> // WO-W, optional, mounts inside
 *     ...rest of landing sections
 *   </LabNotebookCanvas>
 */
export interface LabNotebookCanvasProps {
  children: ReactNode;
  /** Additional classes (e.g. layout, min-height) on the canvas div. */
  className?: string;
  /** Optional override for the data-theme attribute. Defaults to 'dark'
   *  because the lab-notebook colors are tuned for dark backgrounds.
   *  A 'light' variant is OUT OF SCOPE for this WO. */
  theme?: 'dark';
}

export function LabNotebookCanvas({
  children,
  className = '',
  theme = 'dark',
}: LabNotebookCanvasProps) {
  return (
    <div
      data-theme={theme}
      className={`lab-notebook-canvas relative ${className}`}
    >
      {children}
    </div>
  );
}

export default LabNotebookCanvas;
