uniform sampler2D tex;
uniform float red;
uniform float green;
uniform float blue;
uniform float blend;
uniform vec2 textureSize; // Size of the texture being sampled

// Function to perform a simple blur
vec4 blur(sampler2D texture, vec2 texCoord) {
    vec4 sum = vec4(0.0);
    float blurSize = 0.05; // Adjust this for different blur strengths

    // Sample neighboring pixels and average their colors
    sum += texture2D(texture, texCoord + vec2(-blurSize, -blurSize));
    sum += texture2D(texture, texCoord + vec2(0.0, -blurSize));
    sum += texture2D(texture, texCoord + vec2(blurSize, -blurSize));
    sum += texture2D(texture, texCoord + vec2(-blurSize, 0.0));
    sum += texture2D(texture, texCoord);
    sum += texture2D(texture, texCoord + vec2(blurSize, 0.0));
    sum += texture2D(texture, texCoord + vec2(-blurSize, blurSize));
    sum += texture2D(texture, texCoord + vec2(0.0, blurSize));
    sum += texture2D(texture, texCoord + vec2(blurSize, blurSize));

    return sum / 9.0; // Adjust divisor for different blur strengths
}

void main() {
    vec2 texCoord = cogl_tex_coord_in[0].st;
    vec4 original = texture2D(tex, texCoord);

    if (original.a >= 0.5) {
        vec4 blurred = blur(tex, texCoord);
        // blurred.a = original.a;
        vec3 pix_color = blurred.rgb;
        vec3 color = vec3(red * blurred.a, green * blurred.a, blue * blurred.a);
        vec3 finalColor = mix(pix_color, color, blend * 0.75);
        cogl_color_out = vec4(finalColor, (blurred.a + original.a)/2);
    } else {
        cogl_color_out = original;
    }
}