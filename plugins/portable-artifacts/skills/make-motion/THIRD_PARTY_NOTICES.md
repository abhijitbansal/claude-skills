# Third-party notices

make-motion version 2 ports ten fragment shaders from
[gl-transitions](https://github.com/gl-transitions/gl-transitions), fetched at
`gl-transitions/gl-transitions@e7c6ce2c9173ab57382279b58d056133caed5d1f`. Each
lives in `engine/cuts/shaders/<cut>.mjs`, which keeps the file's own header
comment lines as they were and names on its port line what was changed (the
make-motion GLSL ES 3.00 wrapper, the uniform defaults lifted into `params`,
where the author hashed with `sin()`, the integer hash seeded with the film
seed, and in `page-curl` one local variable renamed). The picture is otherwise
the author's.

A file's header names its licence. The repository's `LICENSE` at that commit
covers the rest:

> Individual transitions in the transitions/ directory may have their own license specified in their file header comments. When no license is specified, the transition is covered by this MIT license.

Every file below names its licence in its header.

`ripple` and `cube` were written in this repository and are not listed.

| Cut | Upstream file | Author | Licence | Commit | SHA-256 of the file as fetched |
|---|---|---|---|---|---|
| `page-curl` | `transitions/InvertedPageCurl.glsl` | `Hewlett-Packard` | `BSD-3-Clause` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `94b329575475cf5761a6b50ce6c74f32959b9915e0fcd0be91b7aacdf3d201f4` |
| `directional-warp` | `transitions/DirectionalWarp.glsl` | `pschroen` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `9b4988a12affa2fc89a7a1d87ad2df8c8bfaf185fc83e958188e5c674dbf03ce` |
| `cross-warp` | `transitions/CrossWarp.glsl` | `Eke Péter <peterekepeter@gmail.com>` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `a3a8a4800489f26f8ff3be6b63ccef2ab53279d97df16d469db3d4f57b7df381` |
| `cross-zoom` | `transitions/CrossZoom.glsl` | `rectalogic` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `5f996ec42dee562d3c106612ed967449966bcb73ae7908ca568c31610b9372d2` |
| `wind` | `transitions/Wind.glsl` | `gre` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `a6af68366cd1feb21da596e6503994da8bb052c616ec73d4346006837494a01f` |
| `window-slices` | `transitions/WindowSlices.glsl` | `gre` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `128052b76eaa2802487cbc8940178daa54c2e91bfd0e157de69f2d6295e51449` |
| `polka-dots` | `transitions/PolkaDotsCurtain.glsl` | `bobylito` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `1a11af446cf3c50bf58d1a2b1547092e386bdcf1b7dff71179661f6a4c71d29a` |
| `glitch-memories` | `transitions/GlitchMemories.glsl` | `Gunnar Roth` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `955735ba181ffbaf22b2c2bb14df5627b341bcec75dfe2be61a7d57a1362a4d9` |
| `pixelize` | `transitions/Pixelize.glsl` | `gre` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `a6a3acd0b7e5926ba192127fc761e744f837820407577d22492f9bdeca058d5b` |
| `water-drop` | `transitions/WaterDrop.glsl` | `Paweł Płóciennik` | `MIT` | `e7c6ce2c9173ab57382279b58d056133caed5d1f` | `f18d0b9346368590533e6551cf1f18f775584934e4af78d4fdcabfb03a1efa08` |

## MIT

The nine files marked MIT, under the repository's licence:

```
MIT License

Copyright (c) 2017-present gl-transitions contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## BSD-3-Clause

`page-curl` (`InvertedPageCurl.glsl`), whose header carries this notice; the
module keeps it in its source:

```
Copyright (c) 2010 Hewlett-Packard Development Company, L.P. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
     copyright notice, this list of conditions and the following disclaimer
     in the documentation and/or other materials provided with the
     distribution.
   * Neither the name of Hewlett-Packard nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
