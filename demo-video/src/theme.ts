import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Inter is bundled in public/fonts (OFL, see Inter-LICENSE.txt) so renders work offline.
export const fontFamily = "Inter";
for (const weight of ["400", "600", "800"]) {
  loadFont({ family: fontFamily, url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`), weight });
}

// FrictionIQ's own palette (see the repo README): Liberty Blue for text, indigo for friction,
// coral for fraud, and the light grey page.
export const NAVY = "#0C1629";
export const INDIGO = "#4B49AC";
export const CORAL = "#E5484D";
export const PAGE = "#EEF1F4";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
