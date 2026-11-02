// Release automático a cada push na main (.github/workflows/release.yml).
//
//   bun scripts/release.ts prepare <número>   versão <maior>.<menor> do Cargo.toml + o número da
//                                              execução, e a config do Tauri com essa versão
//   bun scripts/release.ts assets <versão> <dono/repositório>
//                                              instalador sem espaços no nome (o GitHub troca espaços
//                                              por pontos nos anexos), latest.json e notas
import { Glob } from 'bun';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const OUT = 'release';
const [command, ...args] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

if (command === 'prepare') {
  const [run] = args;
  if (!/^\d+$/.test(run ?? '')) throw new Error('Uso: bun scripts/release.ts prepare <número da execução>');
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
  const [, major, minor] = cargo.match(/^version = "(\d+)\.(\d+)\.\d+"/m) ?? [];
  if (!major) throw new Error('Versão não encontrada no src-tauri/Cargo.toml.');
  const version = `${major}.${minor}.${run}`;
  // A versão da config do Tauri vale para o app (package_info) e para o instalador.
  const config = { ...JSON.parse(readFileSync('src-tauri/tauri.release.conf.json', 'utf8')), version };
  writeFileSync(join(OUT, 'tauri.conf.json'), `${JSON.stringify(config, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(version);
} else if (command === 'assets') {
  const [version, repository] = args;
  if (!version || !repository) throw new Error('Uso: bun scripts/release.ts assets <versão> <dono/repositório>');
  const bundle = 'src-tauri/target/release/bundle/nsis';
  const installers = [...new Glob(`*_${version}_x64-setup.exe`).scanSync(bundle)];
  if (installers.length !== 1) throw new Error(`Esperava um instalador da versão ${version} em ${bundle}, encontrei ${installers.length}.`);
  const installer = join(bundle, installers[0]);
  // O .sig só existe com createUpdaterArtifacts e a chave privada do updater.
  const signature = readFileSync(`${installer}.sig`, 'utf8').trim();
  const name = `macropad-studio_${version}_x64-setup.exe`;
  copyFileSync(installer, join(OUT, name));

  // Notas: os commits desde o release anterior (ou os últimos, no primeiro release).
  const git = (...parts: string[]) => Bun.spawnSync(['git', ...parts]).stdout.toString().trim();
  const previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD^');
  const commits = git('log', '--no-merges', '--pretty=- %s', previous ? `${previous}..HEAD` : '-20');
  const notes = commits || `Macropad Studio ${version}`;
  writeFileSync(join(OUT, 'notes.md'), `${notes}\n`);

  writeFileSync(join(OUT, 'latest.json'), `${JSON.stringify({
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': { signature, url: `https://github.com/${repository}/releases/download/v${version}/${name}` } }
  }, null, 2)}\n`);
  console.log(`${basename(installer)} → ${OUT}/${name}, ${OUT}/latest.json`);
} else {
  throw new Error('Uso: bun scripts/release.ts prepare <número> | assets <versão> <dono/repositório>');
}
