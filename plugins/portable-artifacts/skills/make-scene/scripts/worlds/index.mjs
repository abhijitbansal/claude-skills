// World name -> build(data, spec) -> scene graph v1.
import { build as city } from './city.mjs';
import { build as forest } from './forest.mjs';
import { build as galaxy } from './galaxy.mjs';
import { build as terrain } from './terrain.mjs';

export const WORLDS = { city, forest, galaxy, terrain };
