// Compute the next firing time for a cron expression in a given
// timezone. Returns a UNIX timestamp in seconds (UTC).
//
// node-cron doesn't expose a "next firing time" function, so we use
// a thin wrapper around cron-parser, which understands the same
// expression syntax.

import { CronExpressionParser } from 'cron-parser'

/**
 * Next firing time for a cron expression, in seconds since epoch.
 * Throws if the cron expression is invalid.
 */
export function nextCronTimeSeconds(
  cronExpression: string,
  timezone: string,
): number {
  const interval = CronExpressionParser.parse(cronExpression, {
    currentDate: new Date(),
    tz: timezone,
  })
  const next = interval.next().toDate()
  return Math.floor(next.getTime() / 1000)
}
