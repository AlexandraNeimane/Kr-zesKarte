// Prototype settings — change here.
module.exports = {
  PORT: process.env.PORT || 3000,

  // Radio frequency shown in the "no internet" ticker. Placeholder until the real frequency is known.
  RADIO_FREQUENCY: 'FM 111.11',
  // Radio station phone number shown in the ticker. Placeholder until the real number is known.
  RADIO_PHONE: '+371 6711 1111',

  // Emergency service 24h toll-free number that receives automatic cluster alerts.
  EMERGENCY_PHONE: '8000 8989',
  CLUSTER_RADIUS_M: 250,     // same-type reports within this radius...
  CLUSTER_THRESHOLD: 25,     // ...reaching this count trigger an alert
  CLUSTER_WINDOW_HOURS: 24,  // only reports from the last N hours count

  // Resident reports disappear REPORT_VISIBLE_HOURS after the latest report of the same incident
  // (same type within SAME_INCIDENT_RADIUS_M); a new report of it restarts the period.
  REPORT_VISIBLE_HOURS: 48,
  SAME_INCIDENT_RADIUS_M: 250,
  // Optional: URL of an SMS/voice gateway webhook. Without it, alerts are logged and shown as "simulated".
  NOTIFY_WEBHOOK_URL: process.env.NOTIFY_WEBHOOK_URL || '',

  NEARBY_RADIUS_KM: 10,
  DESCRIPTION_MAX_WORDS: 200,
};
