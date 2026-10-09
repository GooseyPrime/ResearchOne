/**
 * Confirming a plan once (RJ-018). Kept apart from the plan screen so the rule
 * can be tested, and used, without drawing the screen.
 */

/** Said when a plan is confirmed a second time: the first confirmation stands and nothing is started twice. */
export const PLAN_ALREADY_CONFIRMED_MESSAGE = 'This plan is already confirmed. The research has started, so there is nothing more to do.';
/** Said when "Confirm & run" is pressed again while the first press is still being sent. */
export const PLAN_CONFIRM_IN_FLIGHT_MESSAGE = 'Your confirmation is being sent. The research will start in a moment.';

/**
 * Sends one confirmation for a plan, however many times it is asked to (RJ-018).
 *
 * The button and the automatic countdown both confirm, and a button is only
 * disabled once the page has drawn again, so two presses in quick succession
 * (or a press as the countdown ends) could each send a request. `sent` is set
 * before anything is awaited: the second caller is told a confirmation is on
 * its way and sends nothing. It is cleared only when the request failed, so the
 * person can try again.
 */
export async function confirmPlanOnce(
  sent: { current: boolean },
  send: () => Promise<{ status?: string; alreadyConfirmed?: boolean; message?: string }>
): Promise<{ outcome: 'confirmed' | 'already_confirmed' | 'in_flight'; message?: string }> {
  if (sent.current) return { outcome: 'in_flight', message: PLAN_CONFIRM_IN_FLIGHT_MESSAGE };
  sent.current = true;
  try {
    const answer = await send();
    // The server says so in `status`, and in plain words in `message`.
    return answer.alreadyConfirmed || answer.status === 'already_confirmed'
      ? { outcome: 'already_confirmed', message: answer.message || PLAN_ALREADY_CONFIRMED_MESSAGE }
      : { outcome: 'confirmed' };
  } catch (error) {
    sent.current = false;
    throw error;
  }
}
