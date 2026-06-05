export function formatTime24(date: Date | string) {
  const value = new Date(date);
  const hours = value.getUTCHours().toString().padStart(2, "0");
  const minutes = value.getUTCMinutes().toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}
