// Santa Soirée 2026 — Node.js server (no dependencies, no React)
// Run:  npm start        → http://localhost:3000
// Dev:  npm run dev      → restarts automatically when you edit server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".woff2":"font/woff2"
};
// Files the browser should never be able to download
const BLOCKED = new Set(["server.js", "package.json", "package-lock.json", "firebase.json", "firestore.rules", "firestore.indexes.json", "README.md"]);

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { res.writeHead(400); return res.end("Bad request"); }
  if (urlPath === "/") urlPath = "/index.html";

  const file = path.normalize(path.join(ROOT, urlPath));
  const name = path.basename(file);
  const insideRoot = file.startsWith(ROOT + path.sep);
  if (!insideRoot || name.startsWith(".") || BLOCKED.has(name) || file.includes(`${path.sep}node_modules${path.sep}`)) {
    res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the home page (routes use #/... so this is just a safety net)
      return fs.readFile(path.join(ROOT, "index.html"), (e2, home) => {
        if (e2) { res.writeHead(500); return res.end("Server error"); }
        res.writeHead(200, { "Content-Type": TYPES[".html"] }); res.end(home);
      });
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🎅 Santa Soirée 2026 is running`);
  console.log(`   Open: http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/#/admin\n`);
});
