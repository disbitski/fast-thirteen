import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4173);
const root = fileURLToPath(new URL(".", import.meta.url));
const dataDirectory = process.env.DATA_DIRECTORY ?? join(root, "data");
const dataPath = join(dataDirectory, "fast-thirteen-data.json");
const temporaryDataPath = `${dataPath}.tmp`;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function browserConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL?.trim() || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() || null,
    migrationWritesEnabled: process.env.SUPABASE_MIGRATION_WRITES_ENABLED === "true",
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function sendConfig(response) {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/javascript; charset=utf-8",
  });
  response.end(
    `window.__FAST_THIRTEEN_CONFIG__ = Object.freeze(${JSON.stringify(browserConfig())});\n`,
  );
}

function readSharedData() {
  if (!existsSync(dataPath)) return null;
  return JSON.parse(readFileSync(dataPath, "utf8"));
}

function writeSharedData(value) {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(temporaryDataPath, JSON.stringify(value, null, 2));
  renameSync(temporaryDataPath, dataPath);
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

createServer((request, response) => {
  if (request.url === "/config.js" && request.method === "GET") {
    sendConfig(response);
    return;
  }

  if (request.url === "/api/data" && request.method === "GET") {
    try {
      sendJson(response, 200, { data: readSharedData() });
    } catch {
      sendJson(response, 500, { error: "Could not read shared data" });
    }
    return;
  }

  if (request.url === "/api/data" && request.method === "PUT") {
    readRequestJson(request)
      .then((value) => {
        writeSharedData(value);
        sendJson(response, 200, { saved: true });
      })
      .catch(() => sendJson(response, 400, { error: "Invalid data" }));
    return;
  }

  const pathname = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filePath = normalize(join(root, pathname));

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[extname(filePath)] ?? "text/plain",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`Fast Thirteen is running at http://localhost:${port}`);
  console.log(`LAN access is available on this Mac at port ${port}`);
});
