import type { DeskApi } from '../electron/contracts';
declare global { interface Window { desk: DeskApi } }
