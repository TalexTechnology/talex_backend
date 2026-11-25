export const CULTURE_FOLLOWUP_POLICY = 'reminders_weekdays_v3';
export const FOLLOWUP_DAY_MS = 24 * 3600000;
const STAGES = [24, 48, 72];
const weekday = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Bogota', weekday: 'short'});

export function isCultureBusinessDay(value) {
  return !['Sat', 'Sun'].includes(weekday.format(value));
}

// Conserva la hora de Colombia y avanza únicamente por días de lunes a viernes.
export function addCultureBusinessDays(value, days = 1) {
  const result = new Date(value);
  for (let count = 0; count < days; count += 1) {
    do { result.setTime(result.getTime() + FOLLOWUP_DAY_MS); }
    while (!isCultureBusinessDay(result));
  }
  return result;
}

function date(value) {
  const parsed = new Date(value);
  return value != null && Number.isFinite(parsed.getTime()) ? parsed : null;
}

// Cada intervalo se cuenta desde el envío real anterior, no desde un horario teórico.
export function cultureFollowupSchedule(lead, {confirmedAt = null, now = new Date()} = {}) {
  const invitedAt = date(lead?.survey_sent_at || lead?.created_at);
  if (!invitedAt) return null;
  const confirmed = date(confirmedAt);
  if (confirmed) return {nextReminder: null, sendAt: addCultureBusinessDays(confirmed)};
  let previousAt = invitedAt;
  let sentIndex = -1;
  for (let index = 0; index < STAGES.length; index += 1) {
    const stage = STAGES[index];
    if (lead[`reminder_${stage}_status`] === 'sent') {
      sentIndex = index;
      previousAt = date(lead[`reminder_${stage}_sent_at`]) || addCultureBusinessDays(invitedAt, index + 1);
    }
  }
  if (sentIndex === 2) return {nextReminder: null, sendAt: addCultureBusinessDays(previousAt)};
  const nextReminder = {stage: STAGES[sentIndex + 1], dueAt: addCultureBusinessDays(previousAt)};
  // Si falta enviar un recordatorio, el informe nunca se adelanta a la secuencia.
  const estimate = addCultureBusinessDays(previousAt, 4 - (sentIndex + 1));
  const sendAt = now >= estimate ? addCultureBusinessDays(now) : estimate;
  return {nextReminder, sendAt};
}
