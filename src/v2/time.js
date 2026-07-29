const KST_TIME_ZONE = 'Asia/Seoul';

function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function kstDate(date = new Date()) {
  const { year, month, day } = kstParts(date);
  return `${year}-${month}-${day}`;
}

function kstDateLabel(date = new Date()) {
  return kstDate(date).replaceAll('-', '.');
}

function kstRunSlot(date = new Date()) {
  const { year, month, day, hour, minute } = kstParts(date);
  return `${year}${month}${day}-${hour}${minute}`;
}

function isSameKstDate(value, date = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(parsed.getTime()) && kstDate(parsed) === kstDate(date);
}

module.exports = {
  KST_TIME_ZONE,
  isSameKstDate,
  kstDate,
  kstDateLabel,
  kstParts,
  kstRunSlot,
};
