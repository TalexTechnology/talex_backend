import assert from 'node:assert/strict';
import {addCultureBusinessDays, cultureFollowupSchedule, isCultureBusinessDay} from '../src/application/culture-followup.js';
import {releaseDueCultureReports} from '../src/application/culture-report-auto.js';

const friday = new Date('2026-11-27T15:00:00-05:00');
const monday = new Date('2026-11-30T15:00:00-05:00');
assert.equal(addCultureBusinessDays(friday).toISOString(), monday.toISOString());
assert.equal(addCultureBusinessDays(new Date('2026-11-26T15:00:00-05:00')).toISOString(), friday.toISOString());
assert.equal(addCultureBusinessDays(friday, 4).toISOString(), '2026-12-03T20:00:00.000Z');
assert.equal(addCultureBusinessDays(friday, 6).toISOString(), '2026-12-07T20:00:00.000Z');
assert.equal(addCultureBusinessDays(new Date('2026-11-28T15:00:00-05:00')).toISOString(), monday.toISOString());
assert.equal(addCultureBusinessDays(new Date('2026-11-29T15:00:00-05:00')).toISOString(), monday.toISOString());
assert.equal(isCultureBusinessDay(new Date('2026-11-28T04:59:59Z')), true); // Viernes en Colombia.
assert.equal(isCultureBusinessDay(new Date('2026-11-28T05:00:00Z')), false);
assert.equal(isCultureBusinessDay(new Date('2026-11-30T04:59:59Z')), false);
assert.equal(isCultureBusinessDay(new Date('2026-11-30T05:00:00Z')), true);

const lead = {survey_sent_at: friday};
let plan = cultureFollowupSchedule(lead, {now: friday});
assert.equal(plan.nextReminder.dueAt.toISOString(), monday.toISOString());
assert.equal(plan.sendAt.toISOString(), '2026-12-03T20:00:00.000Z');
plan = cultureFollowupSchedule(lead, {confirmedAt: friday, now: friday});
assert.equal(plan.nextReminder, null);
assert.equal(plan.sendAt.toISOString(), monday.toISOString());
lead.reminder_72_status = 'sent';
lead.reminder_72_sent_at = friday;
plan = cultureFollowupSchedule(lead, {now: friday});
assert.equal(plan.sendAt.toISOString(), monday.toISOString());

// El bloqueo de fin de semana también cubre trabajos atrasados y no toca la BD.
for (const day of ['2026-11-28T10:00:00-05:00', '2026-11-29T23:59:59-05:00']) {
  const result = await releaseDueCultureReports({now: new Date(day)});
  assert.equal(result.skipped, 'weekend');
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.reminders, []);
}
console.log('PASS weekdays, Colombia midnight boundaries, confirmation, final grace and no weekend delivery');
