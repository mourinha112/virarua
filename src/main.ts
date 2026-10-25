import { criarMundo } from './mundo/mundo';
import { iniciarApp } from './ui/app';
import { iniciarPresenca } from './api/social';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const mundo = criarMundo(canvas);
(window as any).mundo = mundo;
mundo.camera.brasil(true);

document.getElementById('zmais')!.onclick = () => mundo.camera.zoomEm(mundo.VIEW.w / 2, mundo.VIEW.h / 2, 0.5);
document.getElementById('zmenos')!.onclick = () => mundo.camera.zoomEm(mundo.VIEW.w / 2, mundo.VIEW.h / 2, 2);
document.getElementById('zbr')!.onclick = () => { (window as any).ctx?.fecharCartao?.(); mundo.camera.brasil(); };

const carrega = document.getElementById('carrega')!;
document.documentElement.classList.add('pronto');
iniciarApp(mundo).then(() => { try { iniciarPresenca(); } catch { /* sem sessão: tudo bem */ } }).finally(() => { carrega.classList.add('some'); setTimeout(() => carrega.remove(), 500); });
