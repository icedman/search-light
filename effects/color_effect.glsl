uniform sampler2D tex;

uniform vec2 pixel_step;

void main() {
    vec2 tcoord = cogl_tex_coord_in[0].st;
    vec4 c = texture2D(tex, tcoord);
    vec4 cc = c.rgba;

    float rb = 0.45;
    float gg = 0.25;

    if (c.r > rb && c.b > rb && c.g < gg) {
      cc.a = 0;
    } else {
      vec2 tcoord2 = tcoord;
      tcoord2.x += pixel_step[0] * 1.5;
      vec4 c2 = texture2D(tex, tcoord);
      if (c2.r > rb && c2.b > rb && c2.g < gg) {
        cc.a = 0;
      } else {
       vec2 tcoord2 = tcoord;
        tcoord2.x -= pixel_step[0] * 1.5;
        vec4 c2 = texture2D(tex, tcoord);
        if (c2.r > rb && c2.b > rb && c2.g < gg) {
          cc.a = 0.5;
        } 
      }
    }

    cogl_color_out = cc;
}