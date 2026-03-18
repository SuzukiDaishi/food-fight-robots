import fs from "node:fs";

const gltf = JSON.parse(fs.readFileSync("temp.gltf", "utf8"));

console.log(gltf.animations ? gltf.animations.map((animation) => animation.name || "unnamed") : "No animations found");
