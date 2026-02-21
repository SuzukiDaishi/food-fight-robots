const fs = require("fs");
const gltf = JSON.parse(fs.readFileSync("temp.gltf"));
console.log(gltf.animations ? gltf.animations.map(a => a.name || "unnamed") : "No animations found");
