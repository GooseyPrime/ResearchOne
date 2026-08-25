/**
 * There is one research engine.
 *
 * Until WO-AH, a run was either "Standard" or "Deep", and the difference was
 * carried by a request field called `engineVersion`. That field decided real
 * things: whether the objective-specific model ensemble applied at all
 * (`resolveReasoningModels` returns `null` for anything but `'v2'`, so a
 * Standard run silently fell back to the environment default model for every
 * role), whether the adversarial pass got its full instruction, and which
 * quota a finished report was billed against.
 *
 * None of that was a judgement about the request — it was a paywall. The
 * operator's instruction is that every report is produced by the same system
 * and the orchestrating agents decide how hard to work from the request
 * itself. So the engine is a constant now, not an input.
 */
export const RESEARCH_ENGINE_VERSION = 'v2' as const;

/**
 * Whether a finished run consumes the monthly *deep* report allowance.
 *
 * WO-AH-6, and this is an operator decision, not an implementation one.
 *
 * Before WO-AH the deep sub-cap (student 4/month, pro 5, team 20) bounded how
 * often a user could reach the expensive pipeline; everything else ran the
 * cheap one. Now every run reaches the expensive pipeline, so the sub-cap has
 * only two coherent readings:
 *
 *   - `true`  — every run is a deep run. Student drops from 15 reports a month
 *               to 4, pro from 25 to 5. A large cut for people already paying.
 *   - `false` — the sub-cap stops binding and the general monthly cap is the
 *               only limit. Nobody loses capacity; the cost per report rises
 *               for the runs that used to be Standard.
 *
 * `false` is the interim, chosen because it changes nothing about what a user
 * is allowed to do today and is reversible in one line. It is NOT a claim that
 * the deep cap is obsolete. The operator decides; until then this constant is
 * the single place the answer lives.
 */
export const RUN_CONSUMES_DEEP_QUOTA = false;
