原因の9割は「**AnimationMixer を作って play してない**」か「**mixer.update(delta) を毎フレーム呼んでない**」か「**Reactの再レンダリングで mixer / action が作り直されて止まってる**」です。glb内にアニメがあるなら、手順は固定で以下です。

---

## まず確認（デバッグ）

glbを読み込んだ直後にこれを出して、アニメが本当に入ってるか確認してください。

```js
console.log("clips:", gltf.animations.map(a => ({
  name: a.name,
  duration: a.duration,
  tracks: a.tracks.length,
})));
```

* `gltf.animations.length === 0` → そもそもglbに入ってない（export設定/Action未Bakeなど）
* `tracks: 0` が多い → アニメが空（Blender側でNLA/bake/export設定を見直し）

---

## ✅ React + 素の three.js（R3Fを使ってない場合）の最小例

**ポイント:** `mixer` と `clock` を保持して、`requestAnimationFrame` 内で `mixer.update(delta)`。

```js
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

function init(container) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.2, 2.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));

  const loader = new GLTFLoader();
  const clock = new THREE.Clock();

  let mixer = null;

  loader.load("/model.glb", (gltf) => {
    scene.add(gltf.scene);

    console.log("clips:", gltf.animations.map(a => a.name));

    mixer = new THREE.AnimationMixer(gltf.scene);

    // 1本目を再生（複数あるなら名前で選ぶのが安定）
    const clip = gltf.animations[0];
    const action = mixer.clipAction(clip);
    action.reset().play();
  });

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    renderer.render(scene, camera);
  }
  animate();

  return () => {
    renderer.dispose();
    container.removeChild(renderer.domElement);
  };
}
```

### Reactコンポーネントでの注意（重要）

* `useEffect(() => init(...), [])` の **依存配列を空**にして、毎レンダリングでinitしない
* `cleanup` で dispose する（StrictModeだと開発時に2回mountされるので特に大事）

---

## ✅ react-three-fiber（@react-three/fiber + drei）なら一番ラク

`useAnimations` を使うと「mixer更新」が `useFrame` で綺麗に書けます。

```jsx
import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";

function Model({ url }) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);

  // group を渡すのがポイント（ここが null だと効かないことがある）
  const { actions, mixer, names } = useAnimations(animations, group);

  useEffect(() => {
    console.log("animation names:", names);
    const first = names[0];
    if (!first) return;

    actions[first]?.reset().play();

    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer, names]);

  useFrame((_, delta) => {
    mixer.update(delta);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}
```

---

## それでも動かない時の“あるある”チェック

1. **mixer の root が違う**
   `new AnimationMixer(gltf.scene)` が基本。別のオブジェクトに付けるとトラックが見つからず動きません。

2. **Reactの再レンダリングで action が止まる**
   `mixer/actions` を state に入れて再生成、みたいなのは事故りやすいです。`useRef` + `useEffect` で一回だけ初期化寄りに。

3. **SkinnedMesh を clone して壊してる**
   `scene.clone()` するとスケルトン周りが壊れてアニメ効かないことがあります。複製するなら：

```js
import { SkeletonUtils } from "three/examples/jsm/utils/SkeletonUtils.js";
const cloned = SkeletonUtils.clone(gltf.scene);
```

（drei の `<Clone />` を使ってるなら大体OK）

4. **開発環境の React StrictMode で2回実行されてる**
   「一瞬再生して止まる」系はこれが多いです。cleanup をちゃんと書く / 開発時だけStrictMode外す。

---

もしよければ、あなたの **読み込みコード（GLTFLoader / useGLTF 周り）** と **再生してるつもりの箇所** を貼ってください。どのパターン（素three / r3f）かも分かると、ほぼ一発で原因を特定できます。


了解。three.js の **AnimationMixer / AnimationAction** まわりを、**「通常は idle（idol）ループ → ボタンで attack → 終わったら idle にシームレス復帰」**という要件で、実装の “型” と落とし穴までまとめます。

---

## 1) Mixer / Action の基本（ここを外すと動かない）

* `mixer = new THREE.AnimationMixer(root)`

  * `root` は基本 **gltf.scene（そのキャラのルート）**
* `action = mixer.clipAction(clip)`

  * `clip` は `gltf.animations[i]`
* **毎フレーム必須**

  * `mixer.update(delta)`

> つまり「play したのに動かない」の多くは **mixer.update(delta) が呼ばれてない**、または **mixer を React 再レンダで作り直している**です。

---

## 2) ループ idle / 単発 attack の“正しい設定”

### idle（ループ）

* `setLoop(THREE.LoopRepeat, Infinity)`
* `enabled = true`
* `play()`

### attack（単発）

* `setLoop(THREE.LoopOnce, 1)`
* `clampWhenFinished = true`（終わりの姿勢を維持したいなら）

  * ※“戻る”をクロスフェードでやるなら clamp は不要なことも多い

---

## 3) シームレス切替の核心：**同時再生 + 重み（weight）でクロスフェード**

three.js のクロスフェードは「片方を止めて、もう片方を再生」じゃなくて、
**両方を同時に走らせて、重みを入れ替える**のが基本です。

### 典型パターン（推奨）

* idle は **ずっと play しておく**
* attack 発火時に

  * attack を `reset().play()`
  * `attack.crossFadeFrom(idle, fadeSec, warp=true)`
* attack 終了イベントで

  * `idle.crossFadeFrom(attack, fadeSec, warp=true)`

`warp=true` を使うと、クロスフェード中に速度合わせ（時間ワープ）してくれて、切替がより自然になりやすいです。

---

## 4) 実装例（素 three.js でも R3F でも使える “アニメコントローラ”）

### コアロジック（Mixer / Action の扱い方）

```js
import * as THREE from "three";

export function setupCharacterAnimations(gltfScene, clips) {
  const mixer = new THREE.AnimationMixer(gltfScene);

  // 名前で取れるようにしておくと運用が楽
  const clipByName = new Map(clips.map(c => [c.name, c]));

  // ここはあなたのGLBの名前に合わせて
  const idleClip = clipByName.get("Idle") ?? clips[0];
  const attackClip = clipByName.get("Attack") ?? clips[1];

  const idle = mixer.clipAction(idleClip);
  idle.setLoop(THREE.LoopRepeat, Infinity);
  idle.enabled = true;
  idle.play();

  const attack = mixer.clipAction(attackClip);
  attack.setLoop(THREE.LoopOnce, 1);
  attack.clampWhenFinished = false; // クロスフェードで戻すなら false 推奨
  attack.enabled = true;

  const FADE = 0.15;

  function playAttack() {
    // 連打対応：攻撃中に再度押されたら最初から打ち直す
    attack.reset();
    attack.play();

    // idle → attack
    attack.crossFadeFrom(idle, FADE, true);
  }

  // attack 終了で idle に戻す
  mixer.addEventListener("finished", (e) => {
    if (e.action === attack) {
      idle.play(); // 念のため（すでに鳴ってるはず）
      idle.crossFadeFrom(attack, FADE, true);
      // 攻撃アクションを止めておく（残留事故防止）
      attack.stop();
    }
  });

  return { mixer, idle, attack, playAttack };
}
```

### 毎フレーム update（必須）

```js
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  mixer.update(delta);
  renderer.render(scene, camera);
}
```

---

## 5) React / R3F（@react-three/fiber + drei）での定石

**重要:** `mixer/actions` を render ごとに作り直さない。`useAnimations` と `useFrame` で固定化。

```jsx
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";

export function Character({ url, attackTrigger }) {
  const group = useRef();
  const { scene, animations } = useGLTF(url);
  const { actions, mixer, names } = useAnimations(animations, group);

  const idleName = useMemo(() => names.find(n => /idle/i.test(n)) ?? names[0], [names]);
  const attackName = useMemo(() => names.find(n => /attack/i.test(n)) ?? names[1], [names]);

  useEffect(() => {
    if (!actions || !idleName) return;
    const idle = actions[idleName];
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.reset().play();

    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer, idleName]);

  // ボタン押下などで attackTrigger を変化させて発火させる想定
  useEffect(() => {
    if (!actions || !idleName || !attackName) return;
    if (!attackTrigger) return;

    const idle = actions[idleName];
    const attack = actions[attackName];

    const FADE = 0.15;

    attack.setLoop(THREE.LoopOnce, 1);
    attack.clampWhenFinished = false;
    attack.reset().play();
    attack.crossFadeFrom(idle, FADE, true);

    const onFinished = (e) => {
      if (e.action === attack) {
        idle.crossFadeFrom(attack, FADE, true);
        attack.stop();
        mixer.removeEventListener("finished", onFinished);
      }
    };
    mixer.addEventListener("finished", onFinished);
  }, [attackTrigger, actions, mixer, idleName, attackName]);

  useFrame((_, delta) => mixer.update(delta));

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}
```

> `attackTrigger` は「ボタン押したら true にして、次フレームで false に戻す」みたいな “トリガー” だと扱いやすいです。

---

## 6) “シームレス”にするための落とし穴（超重要）

### A. idle ループがカクッと繋ぎ目で跳ねる

これは three.js より **GLB側（Blender等）でループが綺麗に作れてない**ことが多いです。

* 1フレーム目と最終フレームの姿勢が一致してるか
* 補間（曲線）で末端が暴れてないか
* root motion が入っていて位置がズレていないか（キャラが滑る等）

### B. クロスフェードで一瞬だけ変な姿勢になる

* attack の開始ポーズが idle と遠い → fade を少し長く（0.2〜0.3）
* `warp=true` を試す（上の例の通り）
* attack 側を `reset()` しないと前回途中から再生されることがある

### C. 攻撃を連打したらブレンドが壊れる

* 連打時は `attack.reset().play()` で “打ち直し”
* もしくは「攻撃中は次の攻撃をキューに積む」状態機械にする

---

## 7) さらに上級：上半身だけ攻撃（下半身は idle 継続）

three.js 単体は **Humanoidマスク**みたいな仕組みが弱いので、実務的には：

* **GLB側で「上半身だけ動く攻撃クリップ」**を作る（下半身のキーを入れない / または同じ姿勢固定）
* それを three.js 側で idle と同時再生（attack の weight を上げる）
* どうしても three.js 側でやるなら

  * `clip.tracks` をフィルタして「Spine〜腕だけ」みたいにして新しい `AnimationClip` を作る（運用は手間）

必要なら「トラックを bone 名でフィルタして上半身だけのクリップを生成する関数」も書けます。

---

もし可能なら、次の情報を貼ってくれると、あなたの構成に合わせて **最短で動く実装に寄せて**具体コードまで出します：

1. `gltf.animations.map(a=>a.name)` の結果（Idle/Attack の正確な名前）
2. R3F か素 three.js か（drei/useAnimations使ってる？）
3. “ボタン押下”のコード断片（stateの持ち方）
