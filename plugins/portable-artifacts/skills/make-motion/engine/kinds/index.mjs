// Every kind module, imported for its registration. The loopback server and the render page both import this one
// file, so a process that serves a film and the page that draws it always know the same kinds (and so the same
// srcFields). The designed kinds build looks' devices, so the looks and devices are registered here too.
import '../looks/index.mjs';
import '../devices/index.mjs';
import './free.mjs';
import './statement.mjs';
import './number.mjs';
import './clipping.mjs';
import './end.mjs';
import './list.mjs';
import './quote.mjs';
import './compare.mjs';
import './chart.mjs';
import './media.mjs';
import './screen.mjs';
import './map.mjs';
