type ChinaTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function chinaTime(date: Date): ChinaTime {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function dateKey({ year, month, day }: Pick<ChinaTime, 'year' | 'month' | 'day'>) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function previousDateKey(time: ChinaTime) {
  const previous = new Date(Date.UTC(time.year, time.month - 1, time.day) - 86_400_000);
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
}

export function chinaDay(date = new Date()) {
  return dateKey(chinaTime(date));
}

export function chinaCacheSlot(date = new Date(), warmNext = false) {
  const time = chinaTime(date);
  const minutes = time.hour * 60 + time.minute;
  const day = dateKey(time);

  if (warmNext) {
    if (minutes >= 5 * 60 + 40 && minutes < 6 * 60) return `${day}T06`;
    if (minutes >= 11 * 60 + 40 && minutes < 12 * 60) return `${day}T12`;
    if (minutes >= 17 * 60 + 40 && minutes < 18 * 60) return `${day}T18`;
  }

  if (minutes >= 18 * 60) return `${day}T18`;
  if (minutes >= 12 * 60) return `${day}T12`;
  if (minutes >= 6 * 60) return `${day}T06`;
  return `${previousDateKey(time)}T18`;
}
