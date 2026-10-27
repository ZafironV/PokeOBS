// Puente mínimo entre el panel y la aplicación de escritorio: solo existe dentro
// de la ventana de PokeOBS (en el navegador o en OBS, window.pokeobsApp no está).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeobsApp', {
  /** { supported, enabled }: «Iniciar PokeOBS con Windows». */
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', !!enabled),
});
