import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("production-сборка содержит самостоятельный KUSAKA Lab", async () => {
  const [html, source, packageJson, readme, assets] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/KusakaLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readdir(new URL("../dist/assets/", import.meta.url)),
  ]);

  assert.match(html, /<html lang="ru">/);
  assert.match(html, /KUSAKA Raster Emboss Lab/);
  assert.match(source, /Подгони пикчу под пластик/);
  assert.match(source, /3MF · AMS/);
  assert.match(packageJson, /"name": "kusaka-emboss-lab"/);
  assert.match(readme, /Быстрый запуск/);
  assert.doesNotMatch(source, /Bus Farting|Telegram/i);
  assert.ok(assets.some((name) => name.endsWith(".js")));
  assert.ok(assets.some((name) => name.endsWith(".css")));

  await Promise.all([
    access(new URL("../dist/models/kusaka-emboss-source.png", import.meta.url)),
    access(new URL("../dist/models/kusaka-badge-88mm.3mf", import.meta.url)),
    access(new URL("../dist/models/kusaka-badge-88mm.stl", import.meta.url)),
    access(new URL("../dist/models/kusaka-badge-88mm.obj", import.meta.url)),
  ]);
});

test("репозиторий содержит русские руководства и файлы развёртывания", async () => {
  const [deploy, printing, development, compose, dockerfile, license] =
    await Promise.all([
      readFile(new URL("../docs/DEPLOY.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/PRINTING.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/DEVELOPMENT.md", import.meta.url), "utf8"),
      readFile(new URL("../compose.yaml", import.meta.url), "utf8"),
      readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
      readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    ]);

  assert.match(deploy, /GitHub Pages/);
  assert.match(deploy, /Cloudflare Pages/);
  assert.match(printing, /Базовый профиль FDM/);
  assert.match(development, /Пайплайн/);
  assert.match(compose, /8080:80/);
  assert.match(dockerfile, /nginx/);
  assert.match(license, /MIT License/);
});
