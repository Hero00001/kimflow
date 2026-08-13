let currentSettings: Settings | undefined;

export function getSettings(): Settings | undefined {
  return currentSettings;
}

export function setSettings(settings: Settings): void {
  currentSettings = settings;
}
