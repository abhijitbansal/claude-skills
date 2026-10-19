// Every lift: importing this registers each lift's validator check, so any entry point that validates
// a scene spec imports it (api.mjs and validate.mjs do).
export { liftDiagram } from './diagram.mjs';
export { liftDashboard } from './dashboard.mjs';
