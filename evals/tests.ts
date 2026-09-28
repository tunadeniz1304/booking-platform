/** promptfoo test üreticisi: her eval vakası bir test; iddialar `defaultTest`'te. */
import { EVAL_CASES } from "./cases";

export default function generateTests() {
  return EVAL_CASES.map((c) => ({
    description: `${c.task} · ${c.id}${c.redTeam ? " · red-team" : ""} — ${c.description}`,
    vars: { case: c.id, task: c.task },
    metadata: { task: c.task, redTeam: c.redTeam === true },
  }));
}
