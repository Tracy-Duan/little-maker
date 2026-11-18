import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(element) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  element.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 3.4;
  controls.maxDistance = 13;
  controls.autoRotateSpeed = 1.1;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b9a0, 2.3));
  const light = new THREE.DirectionalLight(0xfff7e5, 2.8);
  light.position.set(-3, 7, 5);
  scene.add(light);
  let model;
  let version = 0;

  function resize() {
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(element);
  renderer.setAnimationLoop(() => {
    if (!element.getClientRects().length) return;
    controls.update();
    renderer.render(scene, camera);
  });

  function reset() {
    controls.target.set(0, 0, 0);
    camera.position.set(3.7, 2.5, 6.3);
    controls.update();
  }

  function dispose(object) {
    if (!object) return;
    object.traverse(item => {
      item.geometry?.dispose();
      for (const material of [item.material].flat().filter(Boolean)) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
  }

  async function load(url) {
    const request = ++version;
    controls.autoRotate = false;
    if (model) scene.remove(model);
    dispose(model);
    model = null;
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    let gltf;
    try {
      gltf = await new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    } finally {
      draco.dispose();
    }
    if (request !== version) {
      dispose(gltf.scene);
      return;
    }
    model = gltf.scene;
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    model.scale.multiplyScalar(2.8 / Math.max(size.x, size.y, size.z, .001));
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    model.position.sub(center);
    scene.add(model);
    resize();
    reset();
  }

  return {
    load, reset,
    toggle() {
      controls.autoRotate = !controls.autoRotate;
      return controls.autoRotate;
    }
  };
}
