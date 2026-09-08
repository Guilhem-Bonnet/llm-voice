/**
 * Generates N Claude Code `Stop` hook payloads for concurrency tests
 * (cahier-des-charges.md §44, §79 — "Stop concurrent x10").
 *
 * Each payload carries a unique session_id so 10 simulated Claude Code
 * instances finishing at once can be told apart in the resulting inbox,
 * even though the real collector already guarantees unique filenames via
 * crypto.randomUUID().
 */
export interface ConcurrentStopPayload {
  session_id: string;
  cwd: string;
  hook_event_name: "Stop";
  last_assistant_message: string;
}

export function generateConcurrentStopPayloads(count = 10): ConcurrentStopPayload[] {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index).padStart(2, "0");
    return {
      session_id: `fixture-concurrent-${n}`,
      cwd: `/home/user/projects/concurrent-project-${n}`,
      hook_event_name: "Stop" as const,
      last_assistant_message: `Résumé concurrent n°${index} : tâche terminée avec succès.`
    };
  });
}
