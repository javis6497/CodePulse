import type { ActivitySession } from '../../shared/contracts'

export function hasNewCompletion(
  activities: ActivitySession[],
  states: Map<string, ActivitySession['state']>
): boolean {
  let completed = false
  for (const activity of activities) {
    const previous = states.get(activity.sessionId)
    if (previous && previous !== 'completed' && activity.state === 'completed') completed = true
    states.set(activity.sessionId, activity.state)
  }
  return completed
}
