// GNOME 51 removed Clutter.ShaderEffect.set_shader_source(): the shader is
// now a Cogl.Snippet returned once per class from vfunc_get_static_snippet().
// Older shells keep the original API, so only add the two methods on 51.

'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';

// Fallback used if mutter asks for the snippet before a source was loaded.
// Returning null (or throwing) from vfunc_get_static_snippet makes mutter
// dereference a NULL snippet and crash gnome-shell, so always return one.
const PASSTHROUGH_SOURCE = `
uniform sampler2D tex;
void main() {
  cogl_color_out = texture2D(tex, cogl_tex_coord_in[0].st);
}`;

// Split a full GLSL fragment shader into the code before main() and the body
// of main(), matching braces so nested blocks are handled.
function splitFragmentShader(source) {
  const mainIndex = source.search(/void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/);
  if (mainIndex < 0) return null;
  const braceIndex = source.indexOf('{', mainIndex);

  let depth = 0;
  let endIndex = braceIndex;
  do {
    if (source[endIndex] === '{') depth++;
    else if (source[endIndex] === '}') depth--;
    endIndex++;
  } while (depth > 0 && endIndex < source.length);

  return {
    declarations: source.slice(0, mainIndex),
    body: source.slice(braceIndex + 1, endIndex - 1),
  };
}

function createFragmentSnippet(source) {
  const parts =
    splitFragmentShader(source || '') ||
    splitFragmentShader(PASSTHROUGH_SOURCE);
  // Keep the shader's main() as its own function so its locals and any
  // early returns stay scoped, then call it in place of the fragment hook.
  const snippet = Cogl.Snippet.new(
    Cogl.SnippetHook.FRAGMENT,
    `${parts.declarations}\nvoid search_light_main() {\n${parts.body}\n}\n`,
    null,
  );
  snippet.set_replace('search_light_main();');
  return snippet;
}

class SearchLightShaderEffect extends Clutter.ShaderEffect {}

if (Clutter.ShaderEffect.new_with_snippet) {
  SearchLightShaderEffect.prototype.set_shader_source = function (source) {
    this._snippet_source = source;
  };

  // defineProperty, not assignment: assigning a vfunc_* name walks up to
  // Clutter.ShaderEffect.prototype, where GJS rejects the unimplemented vfunc
  Object.defineProperty(
    SearchLightShaderEffect.prototype,
    'vfunc_get_static_snippet',
    {
      value() {
        try {
          return createFragmentSnippet(this._snippet_source);
        } catch (e) {
          console.log(`[search-light] shader snippet error: ${e}`);
          return createFragmentSnippet(null);
        }
      },
    },
  );
}

export const ShaderEffect = GObject.registerClass({}, SearchLightShaderEffect);
