export const CULTURE_FOLLOWUP_POLICY = 'reminders_24h_v2';
export const FOLLOWUP_DAY_MS = 24 * 3600000;
const STAGES = [24, 48, 72];

function date(value) {
  const parsed = new Date(value);
  return value != null && Number.isFinite(parsed.getTime()) ? parsed : null;
}

// Cada intervalo se cuenta desde el envío real anterior, no desde un horario teórico.
export function cultureFollowupSchedule(lead, {confirmedAt = null, now = new Date()} = {}) {
  const invitedAt = date(lead?.survey_sent_at || lead?.created_at);
  if (!invitedAt) return null;
  const confirmed = date(confirmedAt);
  if (confirmed) return {nextReminder: null, sendAt: new Date(confirmed.getTime() + FOLLOWUP_DAY_MS)};
  let previousAt = invitedAt;
  let sentIndex = -1;
  for (let index = 0; index < STAGES.length; index += 1) {
    const stage = STAGES[index];
    if (lead[`reminder_${stage}_status`] === 'sent') {
      sentIndex = index;
      previousAt = date(lead[`reminder_${stage}_sent_at`]) || new Date(invitedAt.getTime() + stage * 3600000);
    }
  }
  if (sentIndex === 2) return {nextReminder: null, sendAt: new Date(previousAt.getTime() + FOLLOWUP_DAY_MS)};
  const nextReminder = {stage: STAGES[sentIndex + 1], dueAt: new Date(previousAt.getTime() + FOLLOWUP_DAY_MS)};
  // Si falta enviar un recordatorio, el informe nunca se adelanta a la secuencia.
  const estimate = previousAt.getTime() + (4 - (sentIndex + 1)) * FOLLOWUP_DAY_MS;
  const sendAt = new Date(now.getTime() >= estimate ? now.getTime() + FOLLOWUP_DAY_MS : estimate);
  return {nextReminder, sendAt};
}
