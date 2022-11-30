const { St, Shell, GObject, Gio, GLib, Gtk, Meta, Clutter } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();

const SHADER_PATH = GLib.build_filenamev([
  Me.path,
  'effects',
  'color_effect.glsl',
]);

const getShaderSource = (_) => {
  log(Me.path);
  try {
    return Shell.get_file_contents_utf8_sync(SHADER_PATH);
  } catch (e) {
    log(`[d2dl] error loading shader from ${SHADER_PATH}: ${e}`);
    return null;
  }
};

const loadShader = () => {
  let source = getShaderSource();
  let [declarations, main] = source.split(/^.*?main\(\s?\)\s?/m);

  declarations = declarations.trim();
  main = main.trim().replace(/^[{}]/gm, '').trim();

  return { declarations, code: main };
};

let { declarations, code } = loadShader();

var ShapeEffect = GObject.registerClass(
  {},
  class ShapeEffect extends Shell.GLSLEffect {
    _init(params) {
      super._init(params);

      this._pixel = undefined;
      this._pixelLocation = this.get_uniform_location('pixel_step');

      this.set_uniform_float(this._texLocation, 1, [0]);
    }

    vfunc_build_pipeline() {
      this.add_glsl_snippet(
        Shell.SnippetHook.FRAGMENT,
        declarations,
        code,
        true
      );
    }

    get pixel() {
      return this._pixel;
    }

    set pixel(v) {
      if (this._pixel === v) return;
      this._pixel = v;
      this.set_uniform_float(this._pixelLocation, 2, this._pixel);
    }
  }
);
