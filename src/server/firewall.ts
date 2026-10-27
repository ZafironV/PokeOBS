import { execFile } from 'node:child_process';

/** Nombre de la regla que crea scripts/firewall-guard.ps1 mientras PokeOBS está abierto. */
export const FIREWALL_RULE = 'PokeOBS - Proteger comandos de red de RetroArch';

/**
 * ¿Está activa la regla temporal del firewall? Solo lee (no necesita permisos de
 * administrador). null si no se puede saber (otro sistema operativo o error).
 */
export function firewallRuleActive(): Promise<boolean | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`], { windowsHide: true }, (err) => {
      if (!err) resolve(true);
      else resolve(err.code === 1 ? false : null);
    });
  });
}
