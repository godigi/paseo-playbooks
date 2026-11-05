/**
 * Display form of an id: its last segment (steps of a sub-playbook are "pr.investigate"),
 * first letter capitalised ("investigate" → "Investigate"). The id itself is unchanged.
 */
export function stepLabel(id: string): string {
  const name = id.slice(id.lastIndexOf(".") + 1);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

type Titled = { id: string; title?: string; shortTitle?: string };

/** A step's full name, for the details panel and the graph: its `title`, else stepLabel(id). */
export function stepTitle(step: Titled): string {
  return step.title ?? stepLabel(step.id);
}

/** A step's name in the Playbooks screen columns: its `short_title`, else its full name. */
export function stepShortTitle(step: Titled): string {
  return step.shortTitle ?? stepTitle(step);
}

/** stepTitle of the step with this id in a playbook (stepLabel(id) if it is not there). */
export function stepTitleOf(playbook: { steps: Titled[] }, id: string): string {
  return stepTitle(playbook.steps.find((step) => step.id === id) ?? { id });
}
