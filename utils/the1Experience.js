/**
 * THE1 Experience host/child helpers (inventory COE + spawned client proposals).
 */

function idString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value._id != null) return String(value._id);
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

/**
 * @param {object|null|undefined} coe
 * @returns {boolean}
 */
function isThe1ExperienceHost(coe) {
  return !!(coe && coe.is_the1_experience_host === true);
}

/**
 * @param {object|null|undefined} coe
 * @returns {boolean}
 */
function isThe1ExperienceChild(coe) {
  if (!coe) return false;
  const hid = coe.the1_experience_host_id;
  return hid != null && String(hid).trim() !== '';
}

/**
 * @param {object|null|undefined} coe
 * @returns {void}
 */
function assertThe1ExperienceHostNotPayable(coe) {
  if (isThe1ExperienceHost(coe)) {
    throw new Error(
      'THE1 Experience host cannot be paid or accepted as a client experience',
    );
  }
}

/**
 * Event id from a COE event line or selected_seats row.
 * @param {object|null|undefined} row
 * @returns {string}
 */
function eventIdFromRow(row) {
  if (!row) return '';
  return idString(row.event_id || row._id);
}

module.exports = {
  idString,
  isThe1ExperienceHost,
  isThe1ExperienceChild,
  assertThe1ExperienceHostNotPayable,
  eventIdFromRow,
};
