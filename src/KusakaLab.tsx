"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  DEFAULT_IMAGE_LEVELS,
  pixelsToLuminance,
  processLuminanceGrid,
  type ImageLevels,
} from "./image-processing.js";
import {
  createBadgeModel,
  DEFAULT_BADGE_CONFIG,
  disposeBadgeModel,
  getBadgeStats,
  type BadgeConfig,
  type HeightField,
} from "./model-core.js";
import styles from "./kusaka.module.css";

const PUBLIC_BASE = import.meta.env.BASE_URL;
const publicAsset = (path: string) =>
  `${PUBLIC_BASE}${path.replace(/^\/+/, "")}`;
const DEFAULT_SOURCE = {
  url: publicAsset("models/kusaka-emboss-source.png"),
  name: "kusaka-emboss-source.png",
  custom: false,
};
const MASK_RESOLUTION = 384;

type SourceImage = typeof DEFAULT_SOURCE;

type LuminanceSource = {
  data: Float32Array;
  width: number;
  height: number;
};

type RangeControlProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  displayValue: string;
  onChange: (value: number) => void;
};

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  displayValue,
  onChange,
}: RangeControlProps) {
  const progress = ((value - min) / (max - min)) * 100;

  return (
    <label className={styles.rangeRow}>
      <span className={styles.rangeHeading}>
        <span>{label}</span>
        <output>{displayValue}</output>
      </span>
      <input
        aria-label={label}
        className={styles.range}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        type="range"
        value={value}
      />
    </label>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sampleCornerColor(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0];

  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const corners = [
    [0, 0],
    [sourceWidth - 1, 0],
    [0, sourceHeight - 1],
    [sourceWidth - 1, sourceHeight - 1],
  ];

  corners.forEach(([sourceX, sourceY], index) => {
    context.drawImage(
      image,
      sourceX,
      sourceY,
      1,
      1,
      index,
      0,
      1,
      1,
    );
  });

  const pixels = context.getImageData(0, 0, 4, 1).data;
  const color = [0, 0, 0];

  for (let index = 0; index < 4; index += 1) {
    const alpha = pixels[index * 4 + 3] / 255;
    color[0] += pixels[index * 4] * alpha;
    color[1] += pixels[index * 4 + 1] * alpha;
    color[2] += pixels[index * 4 + 2] * alpha;
  }

  return color.map((value) => Math.round(value / 4));
}

function rasterizeSource(image: HTMLImageElement): LuminanceSource {
  const canvas = document.createElement("canvas");
  canvas.width = MASK_RESOLUTION;
  canvas.height = MASK_RESOLUTION;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas 2D is unavailable.");
  }

  const [red, green, blue] = sampleCornerColor(image);
  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.fillRect(0, 0, MASK_RESOLUTION, MASK_RESOLUTION);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scale = Math.min(
    MASK_RESOLUTION / Math.max(1, image.naturalWidth),
    MASK_RESOLUTION / Math.max(1, image.naturalHeight),
  );
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (MASK_RESOLUTION - width) / 2;
  const y = (MASK_RESOLUTION - height) / 2;
  context.drawImage(image, x, y, width, height);

  const pixels = context.getImageData(
    0,
    0,
    MASK_RESOLUTION,
    MASK_RESOLUTION,
  ).data;

  return {
    data: pixelsToLuminance(
      pixels,
      MASK_RESOLUTION,
      MASK_RESOLUTION,
      4,
    ),
    width: MASK_RESOLUTION,
    height: MASK_RESOLUTION,
  };
}

export default function KusakaLab() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const customObjectUrlRef = useRef<string | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [config, setConfig] = useState<BadgeConfig>({
    ...DEFAULT_BADGE_CONFIG,
  });
  const [levels, setLevels] = useState<ImageLevels>({
    ...DEFAULT_IMAGE_LEVELS,
  });
  const [source, setSource] = useState<SourceImage>(DEFAULT_SOURCE);
  const [luminanceSource, setLuminanceSource] =
    useState<LuminanceSource | null>(null);
  const [panelTab, setPanelTab] = useState<"model" | "image">("model");
  const [exportStatus, setExportStatus] = useState("");
  const [imageStatus, setImageStatus] = useState("Загружаю маску…");
  const [viewMode, setViewMode] = useState<"three-quarter" | "top">(
    "three-quarter",
  );
  const deferredConfig = useDeferredValue(config);
  const deferredLevels = useDeferredValue(levels);

  const heightField = useMemo<HeightField | null>(() => {
    if (!luminanceSource) return null;

    return {
      data: processLuminanceGrid(
        luminanceSource.data,
        luminanceSource.width,
        luminanceSource.height,
        deferredLevels,
      ),
      width: luminanceSource.width,
      height: luminanceSource.height,
    };
  }, [deferredLevels, luminanceSource]);

  const stats = useMemo(
    () => getBadgeStats(config, heightField?.width ?? MASK_RESOLUTION),
    [config, heightField?.width],
  );

  useEffect(() => {
    let cancelled = false;
    setImageStatus("Загружаю маску…");
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      if (cancelled) return;

      try {
        setLuminanceSource(rasterizeSource(image));
        setImageStatus(`${image.naturalWidth} × ${image.naturalHeight} px`);
      } catch {
        setLuminanceSource(null);
        setImageStatus("Не смог прочитать эту картинку");
      }
    };

    image.onerror = () => {
      if (cancelled) return;
      setLuminanceSource(null);
      setImageStatus("Файл не открылся");
    };

    image.src = source.url;
    return () => {
      cancelled = true;
    };
  }, [source.url]);

  useEffect(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || !heightField) return;

    canvas.width = heightField.width;
    canvas.height = heightField.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    const imageData = context.createImageData(
      heightField.width,
      heightField.height,
    );

    for (let index = 0; index < heightField.data.length; index += 1) {
      const value = Math.round(heightField.data[index] * 255);
      imageData.data[index * 4] = value;
      imageData.data[index * 4 + 1] = value;
      imageData.data[index * 4 + 2] = value;
      imageData.data[index * 4 + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
  }, [heightField, panelTab]);

  useEffect(
    () => () => {
      if (customObjectUrlRef.current) {
        URL.revokeObjectURL(customObjectUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const host = viewerRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 500);
    camera.position.set(0, -112, 92);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = styles.canvas;
    renderer.domElement.setAttribute(
      "aria-label",
      "Интерактивная 3D-модель растрового шильдика",
    );
    host.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = false;
    controls.minDistance = 78;
    controls.maxDistance = 230;
    controls.minPolarAngle = 0.04;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(0, 0, 2);
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xfff5dd, 0x261f1b, 2.5));

    const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
    keyLight.position.set(-42, -54, 94);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 230;
    keyLight.shadow.camera.left = -80;
    keyLight.shadow.camera.right = 80;
    keyLight.shadow.camera.top = 80;
    keyLight.shadow.camera.bottom = -80;
    scene.add(keyLight);

    const edgeLight = new THREE.DirectionalLight(0xff5a26, 2.2);
    edgeLight.position.set(70, 22, 48);
    scene.add(edgeLight);

    const fillLight = new THREE.DirectionalLight(0xd7e6ff, 1.4);
    fillLight.position.set(-50, 70, 32);
    scene.add(fillLight);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(70, 96),
      new THREE.ShadowMaterial({ color: 0x17110e, opacity: 0.26 }),
    );
    shadow.position.z = -0.08;
    shadow.receiveShadow = true;
    scene.add(shadow);

    const grid = new THREE.GridHelper(142, 20, 0x8f8175, 0xb8aa9e);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.12;
    const gridMaterials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
    });
    scene.add(grid);

    let animationFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      grid.geometry.dispose();
      gridMaterials.forEach((material) => material.dispose());
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (modelRef.current) {
      scene.remove(modelRef.current);
      disposeBadgeModel(modelRef.current);
    }

    const model = createBadgeModel(deferredConfig, {}, heightField);
    modelRef.current = model;
    scene.add(model);

    return () => {
      if (modelRef.current === model) {
        scene.remove(model);
        disposeBadgeModel(model);
        modelRef.current = null;
      }
    };
  }, [deferredConfig, heightField]);

  const updateConfig = <Key extends keyof BadgeConfig>(
    key: Key,
    value: BadgeConfig[Key],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const updateLevel = (
    key: Exclude<keyof ImageLevels, "invert">,
    value: number,
  ) => {
    setLevels((current) => {
      if (key === "blackPoint") {
        return {
          ...current,
          blackPoint: Math.min(value, current.whitePoint - 1),
        };
      }
      if (key === "whitePoint") {
        return {
          ...current,
          whitePoint: Math.max(value, current.blackPoint + 1),
        };
      }
      return { ...current, [key]: value };
    });
  };

  const resetSource = () => {
    if (customObjectUrlRef.current) {
      URL.revokeObjectURL(customObjectUrlRef.current);
      customObjectUrlRef.current = null;
    }
    setSource(DEFAULT_SOURCE);
    setLevels({ ...DEFAULT_IMAGE_LEVELS });
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setImageStatus("Нужна PNG, JPG или WebP");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setImageStatus("Файл тяжелее 15 МБ");
      return;
    }

    if (customObjectUrlRef.current) {
      URL.revokeObjectURL(customObjectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    customObjectUrlRef.current = url;
    setSource({ url, name: file.name, custom: true });
    setPanelTab("image");
  };

  const setCameraView = (mode: "three-quarter" | "top") => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    setViewMode(mode);
    if (mode === "top") {
      camera.up.set(0, 1, 0);
      camera.position.set(0, 0.01, 154);
    } else {
      camera.up.set(0, 0, 1);
      camera.position.set(0, -112, 92);
    }
    camera.lookAt(controls.target);
    controls.update();
  };

  const exportModel = async (format: "3mf" | "stl" | "obj") => {
    if (!luminanceSource) {
      setExportStatus("Сначала дождись картинки");
      return;
    }

    setExportStatus(`Собираю ${format.toUpperCase()}…`);
    const exportHeightField = {
      data: processLuminanceGrid(
        luminanceSource.data,
        luminanceSource.width,
        luminanceSource.height,
        levels,
      ),
      width: luminanceSource.width,
      height: luminanceSource.height,
    };
    const model = createBadgeModel(config, {}, exportHeightField);
    model.updateMatrixWorld(true);
    const diameter = Math.round(config.diameter);
    const filename = `emboss-${diameter}mm.${format}`;

    try {
      if (format === "3mf") {
        const { exportBambu3MF } = await import(
          "./three-mf-exporter.js"
        );
        const data = exportBambu3MF(model, {
          title: `KUSAKA emboss ${diameter} mm`,
        });
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        downloadBlob(new Blob([buffer], { type: "model/3mf" }), filename);
      } else if (format === "stl") {
        const { STLExporter } = await import(
          "three/examples/jsm/exporters/STLExporter.js"
        );
        const data = new STLExporter().parse(model, { binary: true });
        downloadBlob(new Blob([data], { type: "model/stl" }), filename);
      } else {
        const { OBJExporter } = await import(
          "three/examples/jsm/exporters/OBJExporter.js"
        );
        const data = new OBJExporter().parse(model);
        downloadBlob(
          new Blob([data], { type: "text/plain;charset=utf-8" }),
          filename,
        );
      }
      setExportStatus(`${format.toUpperCase()} готов`);
    } catch {
      setExportStatus("Экспорт не сработал — попробуй ещё раз");
    } finally {
      disposeBadgeModel(model);
      window.setTimeout(() => setExportStatus(""), 2400);
    }
  };

  return (
    <main className={styles.shell}>
      <aside className={styles.brandRail}>
        <a
          className={styles.backLink}
          href={PUBLIC_BASE}
          aria-label="Вернуться к началу"
        >
          ←
        </a>
        <div className={styles.brandLockup}>
          <span className={styles.brandIndex}>K / 02</span>
          <strong>KUSAKA</strong>
          <span>RASTER / LAB</span>
        </div>
        <p className={styles.railNote}>
          Пиксель в высоту.
          <br />
          Levels вживую.
          <br />
          Миллиметры честные.
        </p>
        <div className={styles.railFooter}>
          <i aria-hidden="true" />
          <span>LOCAL FDM</span>
        </div>
      </aside>

      <section className={styles.stage} aria-label="Область просмотра модели">
        <header className={styles.stageHeader}>
          <div>
            <span className={styles.eyebrow}>RASTER EMBOSS / 002</span>
            <h1>
              Пиксель,
              <br />
              который можно <em>печатать.</em>
            </h1>
          </div>
          <div className={styles.stageMeta}>
            <span>HEIGHTFIELD</span>
            <strong>{MASK_RESOLUTION}²</strong>
          </div>
        </header>

        <div className={styles.viewer} ref={viewerRef}>
          <div className={styles.viewerHalo} aria-hidden="true" />
          <div className={`${styles.dimension} ${styles.diameter}`}>
            <span>{stats.diameter.toFixed(0)} mm</span>
          </div>
          <div className={`${styles.dimension} ${styles.height}`}>
            <span>{stats.totalHeight.toFixed(1)} mm</span>
          </div>
          <div className={styles.viewSwitch} aria-label="Ракурс модели">
            <button
              aria-pressed={viewMode === "three-quarter"}
              onClick={() => setCameraView("three-quarter")}
              type="button"
            >
              3D
            </button>
            <button
              aria-pressed={viewMode === "top"}
              onClick={() => setCameraView("top")}
              type="button"
            >
              TOP
            </button>
          </div>
          <p className={styles.dragHint}>Тяни, чтобы крутить · колесо — масштаб</p>
        </div>

        <footer className={styles.stageFooter}>
          <div>
            <span>СЛОЁВ ПРИ 0.2</span>
            <strong>{Math.round(stats.totalHeight / 0.2)}</strong>
          </div>
          <div>
            <span>СМЕНА ЦВЕТА НА Z</span>
            <strong>{stats.filamentSwapHeight.toFixed(1)} MM</strong>
          </div>
          <div>
            <span>ЯЧЕЙКА СЕТКИ</span>
            <strong>{stats.cellSize.toFixed(2)} MM</strong>
          </div>
        </footer>
      </section>

      <aside className={styles.controlsPanel}>
        <div className={styles.panelIntro}>
          <span>02 / HEIGHT LAB</span>
          <h2>Подгони пикчу под пластик</h2>
          <p>
            Загрузи ЧБ картинку, дожми Levels и забирай текущий рельеф.
          </p>
        </div>

        <div className={styles.panelTabs} role="tablist" aria-label="Настройки">
          <button
            aria-selected={panelTab === "model"}
            onClick={() => setPanelTab("model")}
            role="tab"
            type="button"
          >
            Геометрия
          </button>
          <button
            aria-selected={panelTab === "image"}
            onClick={() => setPanelTab("image")}
            role="tab"
            type="button"
          >
            Картинка
          </button>
        </div>

        {panelTab === "model" ? (
          <div className={styles.tabBody} role="tabpanel">
            <div className={styles.controls}>
              <RangeControl
                displayValue={`${config.diameter.toFixed(0)} mm`}
                label="Диаметр"
                max={120}
                min={60}
                onChange={(value) => updateConfig("diameter", value)}
                step={1}
                value={config.diameter}
              />
              <RangeControl
                displayValue={`${config.baseThickness.toFixed(1)} mm`}
                label="Подложка"
                max={4}
                min={1.6}
                onChange={(value) => updateConfig("baseThickness", value)}
                step={0.2}
                value={config.baseThickness}
              />
              <RangeControl
                displayValue={`${config.reliefHeight.toFixed(1)} mm`}
                label="Рельеф"
                max={2.4}
                min={0.4}
                onChange={(value) => updateConfig("reliefHeight", value)}
                step={0.2}
                value={config.reliefHeight}
              />
              <RangeControl
                displayValue={`${config.rimWidth.toFixed(1)} mm`}
                label="Ширина борта"
                max={5}
                min={1.6}
                onChange={(value) => updateConfig("rimWidth", value)}
                step={0.2}
                value={config.rimWidth}
              />
              <RangeControl
                displayValue={`${Math.round(config.logoScale * 100)}%`}
                label="Масштаб картинки"
                max={0.92}
                min={0.58}
                onChange={(value) => updateConfig("logoScale", value)}
                step={0.01}
                value={config.logoScale}
              />
              <RangeControl
                displayValue={`${Math.round(config.imageOffsetX * 100)}%`}
                label="Сдвиг X"
                max={0.05}
                min={-0.05}
                onChange={(value) => updateConfig("imageOffsetX", value)}
                step={0.01}
                value={config.imageOffsetX}
              />
              <RangeControl
                displayValue={`${Math.round(config.imageOffsetY * 100)}%`}
                label="Сдвиг Y"
                max={0.05}
                min={-0.05}
                onChange={(value) => updateConfig("imageOffsetY", value)}
                step={0.01}
                value={config.imageOffsetY}
              />
            </div>
            <div className={styles.toggles}>
              <button
                aria-pressed={config.includeRing}
                onClick={() =>
                  updateConfig("includeRing", !config.includeRing)
                }
                type="button"
              >
                <span>Круглый борт</span>
                <i aria-hidden="true" />
              </button>
              <button
                onClick={() =>
                  setConfig({ ...DEFAULT_BADGE_CONFIG })
                }
                type="button"
              >
                <span>Сброс геометрии</span>
                <b aria-hidden="true">↺</b>
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.tabBody} role="tabpanel">
            <section className={styles.sourceCard}>
              <div className={styles.maskPreview}>
                <canvas ref={maskCanvasRef} />
                {!heightField && <span>…</span>}
              </div>
              <div className={styles.sourceMeta}>
                <small>ИСТОЧНИК / {imageStatus}</small>
                <strong title={source.name}>{source.name}</strong>
                <label className={styles.uploadButton}>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      handleFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                  Добавить свою
                </label>
              </div>
            </section>

            <button
              aria-pressed={levels.invert}
              className={styles.polarityButton}
              onClick={() =>
                setLevels((current) => ({
                  ...current,
                  invert: !current.invert,
                }))
              }
              type="button"
            >
              <span>
                {levels.invert ? "Тёмное = рельеф" : "Светлое = рельеф"}
              </span>
              <i aria-hidden="true" />
            </button>

            <div className={styles.controls}>
              <RangeControl
                displayValue={levels.blackPoint.toFixed(0)}
                label="Black point"
                max={254}
                min={0}
                onChange={(value) => updateLevel("blackPoint", value)}
                step={1}
                value={levels.blackPoint}
              />
              <RangeControl
                displayValue={levels.whitePoint.toFixed(0)}
                label="White point"
                max={255}
                min={1}
                onChange={(value) => updateLevel("whitePoint", value)}
                step={1}
                value={levels.whitePoint}
              />
              <RangeControl
                displayValue={levels.gamma.toFixed(2)}
                label="Gamma"
                max={3}
                min={0.25}
                onChange={(value) => updateLevel("gamma", value)}
                step={0.05}
                value={levels.gamma}
              />
              <RangeControl
                displayValue={`${Math.round(levels.threshold * 100)}%`}
                label="Threshold"
                max={0.98}
                min={0.02}
                onChange={(value) => updateLevel("threshold", value)}
                step={0.01}
                value={levels.threshold}
              />
              <RangeControl
                displayValue={`${Math.round(levels.softness * 100)}%`}
                label="Мягкость края"
                max={0.35}
                min={0}
                onChange={(value) => updateLevel("softness", value)}
                step={0.01}
                value={levels.softness}
              />
              <RangeControl
                displayValue={`${levels.blur.toFixed(0)} px`}
                label="Blur до Levels"
                max={4}
                min={0}
                onChange={(value) => updateLevel("blur", value)}
                step={1}
                value={levels.blur}
              />
            </div>

            <div className={styles.imageActions}>
              <button
                onClick={() => setLevels({ ...DEFAULT_IMAGE_LEVELS })}
                type="button"
              >
                Сбросить Levels
              </button>
              <button onClick={resetSource} type="button">
                Вернуть KUSAKA
              </button>
            </div>
          </div>
        )}

        <section className={styles.printCard}>
          <span className={styles.printCardNumber}>03</span>
          <div>
            <strong>Базовый рецепт</strong>
            <p>
              3MF: основа → F1 · рельеф → F2. Сопоставь катушки AMS
              перед печатью.
            </p>
          </div>
        </section>

        <div className={styles.exportArea}>
          <div className={styles.exportButtons}>
            <button
              className={styles.primaryExport}
              disabled={!heightField}
              onClick={() => exportModel("3mf")}
              type="button"
            >
              <span>3MF · AMS</span>
              <b>↓</b>
            </button>
            <button
              disabled={!heightField}
              onClick={() => exportModel("stl")}
              type="button"
            >
              STL
            </button>
            <button
              disabled={!heightField}
              onClick={() => exportModel("obj")}
              type="button"
            >
              OBJ
            </button>
          </div>
          <div className={styles.secondaryLinks}>
            <a
              href={publicAsset("models/kusaka-emboss-source.png")}
              download
            >
              Исходная PNG
            </a>
            <span>{source.custom ? "Своя маска" : "KUSAKA default"}</span>
          </div>
          <p aria-live="polite" className={styles.exportStatus}>
            {exportStatus ||
              `3MF: F1 / F2 · STL: смена после ${stats.filamentSwapHeight.toFixed(1)} мм`}
          </p>
        </div>
      </aside>
    </main>
  );
}
