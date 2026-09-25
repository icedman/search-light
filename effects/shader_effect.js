// GNOME 51 removed Clutter.ShaderEffect.set_shader_source(): the shader is
// now a Cogl.Snippet returned once per class from vfunc_get_static_snippet().
// Older shells keep the original API, so only add the two methods on 51.

'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';

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
        // declarations go before main(), the body of main() replaces the hook
        let [declarations, main] = this._snippet_source.split('void main()');
        let snippet = new Cogl.Snippet(
          Cogl.SnippetHook.FRAGMENT,
          declarations,
          null,
        );
        snippet.set_replace(
          main.slice(main.indexOf('{') + 1, main.lastIndexOf('}')),
        );
        return snippet;
      },
    },
  );
}

export const ShaderEffect = GObject.registerClass({}, SearchLightShaderEffect);
