// Who owns a main-agent usage record: the keep-warm ping, or the user's turn. Pure: the caller
// keeps the side effects (filing the ping, ingesting the call, resetting flags).

/**
 * @param {object} facts
 * @param {boolean} facts.awaiting  a ping is awaited: in flight, a late reply open, or its tail open
 * @param {boolean} facts.inFlight  a ping is out right now
 * @param {boolean} facts.pingOwed  a ping message was seen and its record has not arrived
 * @param {"ping"|"user"|null} facts.turnSource  who started the turn now running, when known
 * @param {boolean} facts.promptSinceSend  a prompt reached the hook since our last send
 * @param {boolean} facts.hostReportsUserMessage  the host sends user.message for real turns
 * @returns {{ owner: "ping"|"user", spendsTypedPrompt: boolean }}
 */
export function attributeUsage({ awaiting, inFlight, pingOwed, turnSource, promptSinceSend, hostReportsUserMessage }) {
  // A prompt typed since the last send makes a record that arrives after the ping gave up the user's.
  // A host that reports user.message tells its own ping apart by that message, so a prompt typed while
  // the ping is in flight proves nothing there; a host that does not report it has only the prompt.
  const typedSince = promptSinceSend && turnSource !== "ping" && (!inFlight || !hostReportsUserMessage);
  // A ping in flight on a host that does not report user.message: nothing can tell a user's record from
  // the ping's, so the first record is the ping's, even if the user typed. The user's own turn, whose
  // record may come later, is booked as a call once the ping is answered or given up on.
  const pingFirst = inFlight && !hostReportsUserMessage;
  // A host that does not report user.message is told apart by the ping awaited. A message
  // typed after the ping's own message must not take the ping's record (pingOwed).
  const isPing = pingFirst || (pingOwed && awaiting) || turnSource === "ping" || (awaiting && turnSource !== "user" && !typedSince);
  if (isPing) return { owner: "ping", spendsTypedPrompt: false };
  // Booked as a real call: the typed prompt it answers is spent.
  return { owner: "user", spendsTypedPrompt: typedSince };
}
