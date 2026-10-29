import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("function isGeneratedSpecificationLabel(label) {");
const end = source.indexOf("function getProductImages(product) {", start);
assert.ok(start >= 0 && end > start, "specification formatter functions are available");

const context = {
  parseJSON(value, fallback) {
    if (typeof value !== "string") return value ?? fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  },
};
vm.runInNewContext(source.slice(start, end) + "\nthis.specsArray = specsArray;", context);
const specsArray = context.specsArray;

test("JB TECH numbered specifications are sorted by original sequence and displayed without numbers", () => {
  const input = [
    "3. RAM: 12 GB o 16 GB, según configuración.",
    "9. Audio: cuatro altavoces con audio espacial.",
    "2. Pantalla: Dynamic AMOLED 2X de 14,6 pulgadas, 2960 × 1848, 120 Hz.",
    "8. Batería: 11,600 mAh con carga de hasta 45 W.",
    "1. Procesador: MediaTek Dimensity 9500, ocho núcleos.",
    "11. Accesorio: S Pen incluido.",
    "5. Expansión: microSD de hasta 2 TB.",
    "12. Resistencia: certificación IP68.",
    "10. Conectividad: Wi-Fi 7 y Bluetooth 6.0.",
    "4. Almacenamiento: 256 GB, 512 GB o 1 TB, según versión.",
    "7. Cámara frontal: 12 MP ultra gran angular.",
    "6. Cámaras traseras: 13 MP + 8 MP ultra gran angular.",
    "13. Sistema operativo: Android 17 con One UI 9.",
  ];
  const result = Array.from(specsArray(input));
  assert.deepEqual(result, [
    "Procesador: MediaTek Dimensity 9500, ocho núcleos.",
    "Pantalla: Dynamic AMOLED 2X de 14,6 pulgadas, 2960 × 1848, 120 Hz.",
    "RAM: 12 GB o 16 GB, según configuración.",
    "Almacenamiento: 256 GB, 512 GB o 1 TB, según versión.",
    "Expansión: microSD de hasta 2 TB.",
    "Cámaras traseras: 13 MP + 8 MP ultra gran angular.",
    "Cámara frontal: 12 MP ultra gran angular.",
    "Batería: 11,600 mAh con carga de hasta 45 W.",
    "Audio: cuatro altavoces con audio espacial.",
    "Conectividad: Wi-Fi 7 y Bluetooth 6.0.",
    "Accesorio: S Pen incluido.",
    "Resistencia: certificación IP68.",
    "Sistema operativo: Android 17 con One UI 9.",
  ]);
  assert.ok(result.every(line => !/^\d{1,3}[.)]\s/.test(line)));
});

test("unnumbered lists preserve their order and technical decimal values remain unchanged", () => {
  assert.deepEqual(Array.from(specsArray(["RAM: 8 GB", "Almacenamiento: 256 GB"])), [
    "RAM: 8 GB", "Almacenamiento: 256 GB"
  ]);
  assert.equal(specsArray(["Frecuencia: 5.4 GHz"])[0], "Frecuencia: 5.4 GHz");
});

test("numbered object values also normalize correctly", () => {
  assert.deepEqual(Array.from(specsArray([
    "2. Pantalla: Dynamic AMOLED 2X",
    "1. Procesador: Dimensity 9500",
  ])), ["Procesador: Dimensity 9500", "Pantalla: Dynamic AMOLED 2X"]);
});
