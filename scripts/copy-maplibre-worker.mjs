/**
 * MapLibre 6 web worker'ı ESM olarak `import.meta.url`'e göre yükler; bundler çıktısında
 * bu yol bulunmaz. Worker ve paylaşılan modül `public/vendor/maplibre/` altına kopyalanır,
 * harita bileşeni `setWorkerUrl` ile buraya yönlendirir. `predev`/`prebuild` ile çalışır.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/maplibre-gl/dist");
const dest = path.resolve("public/vendor/maplibre");
mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log("maplibre worker → public/vendor/maplibre");
