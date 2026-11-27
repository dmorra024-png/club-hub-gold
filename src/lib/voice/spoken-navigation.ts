/** Deepgram may ignore InjectAgentMessage during user speech.
 * This boundary is strictly about speech timing; it never authorizes or
 * executes an administrative action. */
export function canSpeakNavigation(
  userSpeaking: boolean,
  providerReady: boolean,
  created: number,
  now: number,
) {
  return !userSpeaking && providerReady && Number.isFinite(created) &&
    now >= created && now - created <= 12000;
}
