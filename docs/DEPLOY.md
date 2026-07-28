# Развёртывание

KUSAKA Emboss Lab — полностью статическое Vite-приложение. После
`npm run build` всё необходимое находится в папке `dist/`. Серверная база,
переменные окружения и постоянное хранилище не нужны.

## Требования

- Node.js 22 или новее;
- npm;
- примерно 1 ГБ свободного места на время установки и сборки.

## GitHub Pages

В репозитории уже есть workflow `.github/workflows/pages.yml`.

1. Сделай fork репозитория.
2. Открой **Settings → Pages**.
3. В поле **Source** выбери **GitHub Actions**.
4. Запусти workflow **Публикация GitHub Pages** вручную либо отправь commit в
   ветку `main`.
5. Адрес появится в разделе **Deployments**.

Workflow автоматически задаёт базовый путь `/<имя-репозитория>/`. Для
репозитория вида `<user>.github.io` или собственного домена замени
`VITE_BASE_PATH` в workflow на `/`.

## Cloudflare Pages

1. Создай Pages-проект и подключи GitHub-репозиторий.
2. Укажи build command: `npm run build`.
3. Укажи output directory: `dist`.
4. Укажи версию Node.js: `22`.
5. Сохрани настройки и запусти deployment.

Для размещения не в корне домена добавь переменную сборки
`VITE_BASE_PATH=/нужный-путь/`.

## Netlify

Файл `netlify.toml` уже находится в проекте.

1. Импортируй GitHub-репозиторий в Netlify.
2. Сервис автоматически увидит `npm run build` и папку `dist`.
3. Нажми **Deploy**.

## Vercel

Файл `vercel.json` уже содержит нужные параметры.

1. Импортируй репозиторий в Vercel.
2. Проверь, что выбран framework **Vite**.
3. Нажми **Deploy**.

## Docker Compose

```bash
docker compose up --build -d
```

Приложение откроется на `http://localhost:8080`.

```bash
docker compose logs -f
docker compose down
```

Порт можно поменять в `compose.yaml`, например `"3000:80"`.

## Docker без Compose

```bash
docker build -t kusaka-emboss-lab .
docker run --rm -p 8080:80 kusaka-emboss-lab
```

## Свой nginx или другой статический сервер

```bash
npm ci
npm run build
```

Скопируй содержимое `dist/` в корень сайта. Для nginx достаточно:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

## Размещение в подпапке

Vite должен знать публичный базовый путь во время сборки:

```bash
VITE_BASE_PATH=/tools/emboss/ npm run build
```

После этого сайт нужно разместить именно по адресу `/tools/emboss/`.

## Проверка перед публикацией

```bash
npm ci
npm test
npm run preview
```

Проверь загрузку своей картинки, изменение Levels и скачивание обоих форматов.
