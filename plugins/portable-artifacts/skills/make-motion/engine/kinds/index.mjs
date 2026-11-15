// Every kind module, imported for its registration. The loopback server and the render page both import this one
// file, so a process that serves a film and the page that draws it always know the same kinds (and so the same
// srcFields). A later task adds its kind here.
import './free.mjs';
