export const retention = 30 * 24 * 60 * 60 * 1000;
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" });
const jakartaFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
});

export function memoryDay(photo) {
  if (photo.date && Number.isFinite(Date.parse(photo.date + "T00:00:00Z"))) return photo.date;
  const parts = jakartaFormat.formatToParts(new Date(photo.created));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}

export function memoryLabel(photo) {
  return dateFormat.format(new Date(memoryDay(photo) + "T00:00:00Z"));
}

export function lastYearDay(now = new Date()) {
  const [year, month, day] = memoryDay({created: +now}).split("-").map(Number);
  const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function validSlug(slug) {
  return slug.length >= 3 && slug.length <= 30 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    && !["www", "api", "admin", "app", "auth", "login", "support", "mail"].includes(slug);
}
