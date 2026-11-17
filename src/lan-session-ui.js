export function createLanInviteUrl(href, roomId) {
  const invite = new URL(href);
  invite.searchParams.set("room", String(roomId || "local"));
  invite.hash = "";
  return invite.toString();
}

export function describePilotCapacity(snapshot) {
  const settings = snapshot?.settings;
  const capacity = settings?.vehicleLimit;
  const pilots = Number.isInteger(settings?.humans)
    ? settings.humans
    : Array.isArray(snapshot?.cars)
      ? snapshot.cars.filter(car => !car.isBot).length
      : null;
  if (!Number.isInteger(pilots) || !Number.isInteger(capacity)) return "Esperando snapshot del servidor";
  return `${pilots}/${capacity} pilotos`;
}
