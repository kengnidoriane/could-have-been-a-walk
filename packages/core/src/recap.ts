/** What came out of the walk, from the voice memo or typed notes. */
export interface Recap {
  /** One or two sentences. */
  summary: string;
  decisions: string[];
  actions: { task: string; owner: string; due: string }[];
}

const DECISION =
  /\b(decided|decide|agreed|agree|we('| wi)ll go with|chose|choose|settled on|approved)\b/i;
const ACTION =
  /\b(will|to do|todo|action|follow[- ]up|send|share|draft|call|book|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week|end of))\b/i;
const OWNER = /^\s*([A-Z][a-z]+)\s+(will|to|should|can)\b/;
const DUE =
  /\bby ((next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|week|end of [a-z ]+))\b/i;

/**
 * Keyword fallback when the local model is unavailable: decisions and action items are the
 * sentences that sound like them. Rough, but never empty-handed and fully offline.
 */
export function recapHeuristic(text: string): Recap {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  const decisions = sentences.filter((s) => DECISION.test(s)).slice(0, 5);
  const actions = sentences
    .filter((s) => !decisions.includes(s) && ACTION.test(s))
    .slice(0, 8)
    .map((task) => ({
      task: task.replace(/[.!]$/, ''),
      owner: OWNER.exec(task)?.[1] ?? 'unassigned',
      due: DUE.exec(task)?.[1] ?? '',
    }));
  const summary = sentences.slice(0, 2).join(' ').slice(0, 240);
  return { summary, decisions, actions };
}

/** Plain-text version for copying into chat or email. */
export function recapToText(title: string, recap: Recap): string {
  const lines = [`Walking meeting recap: ${title}`, '', recap.summary];
  if (recap.decisions.length > 0) {
    lines.push('', 'Decisions:', ...recap.decisions.map((d) => `- ${d}`));
  }
  if (recap.actions.length > 0) {
    lines.push(
      '',
      'Action items:',
      ...recap.actions.map((a) => `- ${a.task} (${a.owner}${a.due ? `, ${a.due}` : ''})`),
    );
  }
  return lines.join('\n');
}
