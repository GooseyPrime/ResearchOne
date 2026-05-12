import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HeroPipelineVisual from '../HeroPipelineVisual';
import { resolvePersona, type PersonaId } from './personaResolver';
import { getPersonaContent } from './personaContent';

/**
 * Persona-aware hero — wraps the existing Hero layout with a
 * client-side persona switch.
 *
 * Per Cursor rule 26 I-3: when persona resolves to 'default', the
 * rendered output is character-for-character identical to the
 * existing `Hero.tsx`. We achieve this by reading the 'default'
 * variant from `personaContent.ts`, which is locked to match
 * `Hero.tsx`.
 *
 * Per Cursor rule 26 I-7: resolution is deterministic for a given
 * (search, referrer, pathname) triple. After mount, `forcePersona`
 * (if provided) or `resolvePersona()` sets the persona; the
 * `onPersonaResolved` ref always sees the latest parent callback
 * without re-running resolution when only the callback identity changes.
 *
 * Per Cursor rule 26 I-1: SSR-safe — the resolver returns 'default'
 * when `window` is undefined, and we render the default copy on the
 * server, then re-resolve client-side once mounted. There is a brief
 * hydration moment where the copy may transition from 'default' to
 * the persona variant; this is acceptable because (a) most inbound
 * traffic is direct or has a recognizable referrer that resolves
 * synchronously after mount, and (b) the alternative — flashing a
 * skeleton — looks worse and breaks LCP.
 *
 * The component intentionally does NOT emit analytics on resolve.
 * Analytics is opt-in via the parent (see PATCH-V05).
 *
 * Usage:
 *   import PersonaAwareHero from './components/landing/persona/PersonaAwareHero';
 *   <PersonaAwareHero onPersonaResolved={(p) => trackPersonaView(p)} />
 */

export interface PersonaAwareHeroProps {
  /** Optional analytics hook fired once after client-side resolution.
   *  Receives the resolved persona id and the current path. */
  onPersonaResolved?: (persona: PersonaId, path: string) => void;
  /** Force a specific persona — useful for A/B testing or for
   *  rendering a per-persona-route page directly. */
  forcePersona?: PersonaId;
}

export default function PersonaAwareHero({
  onPersonaResolved,
  forcePersona,
}: PersonaAwareHeroProps) {
  // SSR safety: start with 'default'. Re-resolve after mount.
  const [persona, setPersona] = useState<PersonaId>(forcePersona ?? 'default');
  const onPersonaResolvedRef = useRef(onPersonaResolved);
  onPersonaResolvedRef.current = onPersonaResolved;

  useEffect(() => {
    if (forcePersona) {
      setPersona(forcePersona);
      onPersonaResolvedRef.current?.(forcePersona, window.location.pathname);
      return;
    }
    const resolved = resolvePersona();
    setPersona(resolved);
    onPersonaResolvedRef.current?.(resolved, window.location.pathname);
  }, [forcePersona]);

  const content = useMemo(() => getPersonaContent(persona), [persona]);

  return (
    <section
      data-persona={persona}
      className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center sm:px-6"
    >
      <div className="space-y-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-r1-accent">
          {content.eyebrow}
        </p>
        <h1 className="font-serif text-4xl leading-tight text-r1-text sm:text-6xl">
          {content.headline}
        </h1>
        <p className="max-w-xl text-base text-r1-text-muted sm:text-lg">
          {content.subhead}
        </p>
        <div className="flex flex-wrap gap-3">
          {content.ctas.map((cta) => (
            <Link
              key={cta.to}
              to={cta.to}
              className={
                cta.variant === 'primary'
                  ? 'rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep'
                  : 'rounded-md border border-white/20 px-5 py-3 font-semibold text-r1-text hover:border-r1-accent'
              }
            >
              {cta.label}
            </Link>
          ))}
        </div>
        {content.proofLine && (
          <p className="max-w-xl text-xs text-r1-text-muted/80 pt-2">
            {content.proofLine}
          </p>
        )}
      </div>
      <HeroPipelineVisual />
    </section>
  );
}
