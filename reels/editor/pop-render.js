/* Renders the pop layer (pop.js) to a transparent .mov with headless Chromium.
   Usage: node pop-render.js spec.json out.mov
   spec: {W,H,fps,dur,fonts:[{family,weight,style,path}], ...pop.js spec}
   Needs playwright-core (npm i playwright-core@1.56.1) and a Chromium; set CHROMIUM to its path. */
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const { chromium } = require(process.env.PW_CORE || "playwright-core");
const [specPath, out] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const exe = process.env.CHROMIUM || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

(async () => {
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  const fonts = spec.fonts.map(f => ({ ...f, data: fs.readFileSync(f.path).toString("base64") }));
  await page.setContent("<canvas id=c></canvas>");
  await page.addScriptTag({ path: path.join(__dirname, "pop.js") });
  await page.evaluate(async ({ spec, fonts }) => {
    for (const f of fonts) {
      const bin = Uint8Array.from(atob(f.data), ch => ch.charCodeAt(0));
      const face = new FontFace(f.family, bin, { weight: String(f.weight), style: f.style });
      document.fonts.add(await face.load());
    }
    const c = document.getElementById("c"); c.width = spec.W; c.height = spec.H;
    window.ctx = c.getContext("2d"); window.pop = makePop(spec.W, spec.H, spec); window.canvas = c;
  }, { spec, fonts });
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "png", "-framerate", String(spec.fps),
    "-i", "-", "-c:v", "qtrle", out], { stdio: ["pipe", "inherit", "inherit"] });
  const n = Math.ceil(spec.dur * spec.fps);
  let empty = null;
  for (let k = 0; k < n; k++) {
    const url = await page.evaluate(t => pop.draw(ctx, t) ? canvas.toDataURL("image/png") : null, k / spec.fps);
    let buf;
    if (url) buf = Buffer.from(url.split(",")[1], "base64");
    else buf = empty || (empty = Buffer.from((await page.evaluate(() => { ctx.clearRect(0, 0, canvas.width, canvas.height); return canvas.toDataURL("image/png"); })).split(",")[1], "base64"));
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on("close", c => c ? rej(new Error("ffmpeg " + c)) : res()));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
