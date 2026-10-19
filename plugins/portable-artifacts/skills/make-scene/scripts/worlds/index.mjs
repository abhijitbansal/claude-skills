// World name -> build(data, spec) -> scene graph v1. Forest and galaxy arrive in Task 6.
import { build as city } from './city.mjs';
import { build as terrain } from './terrain.mjs';

const notImplemented = (name) => () => {
  throw new Error(`world ${name} is not implemented yet`);
};

export const WORLDS = { city, forest: notImplemented('forest'), galaxy: notImplemented('galaxy'), terrain };
